import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { canRemoveWorkspaceMember, hasWorkspaceWriteRole } from './workspace-access.js';
import { isValidProfileAvatarDataUrl } from './profile-avatar.js';

const app = express(); const httpServer = createServer(app); const prisma = new PrismaClient();
const PORT = Number(process.env.API_PORT || 4000);
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters in every environment.');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
if (process.env.NODE_ENV === 'production' && !redis) throw new Error('REDIS_URL must be configured in production for collaboration access revocation.');
redis?.on('error', error => console.error('API Redis error', error));
const ACCESS_REVOCATION_CHANNEL = 'collabspace:workspace-access-revoked';
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (process.env.WEB_ORIGIN || 'http://localhost:3000').split(','), credentials: true }));
app.use(express.json({ limit: '2mb' })); app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' } });

type AuthRequest = Request & { user?: { id: string; email: string } };
const asyncRoute = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: AuthRequest, res: Response, next: NextFunction) => Promise.resolve(fn(req,res)).catch(next);
const hasWorkspaceWriteAccess = async (userId: string, workspaceId: string) => {
 const member = await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId,workspaceId}},select:{role:true}});
 return member !== null && hasWorkspaceWriteRole(member.role);
};
const invalidateWorkspaceAccess = async (workspaceId: string, userId: string) => {
 if (!redis) throw new Error('Configure REDIS_URL before changing workspace membership so active collaboration sessions can be revoked.');
 const subscribers=await redis.publish(ACCESS_REVOCATION_CHANNEL, JSON.stringify({workspaceId,userId}));
 if(subscribers===0)throw new Error('The collaboration service is unavailable for membership revocation.');
 disconnectRealtimeUser(userId);
};
const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
 const token = req.headers.authorization?.replace(/^Bearer\s+/i,'');
 if (!token) return res.status(401).json({ error: 'Authentication required' });
 try { req.user = jwt.verify(token, SECRET) as { id: string; email: string }; next(); } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
};
const slugify = (s:string) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') + '-' + Math.random().toString(36).slice(2,7);
app.get('/health', (_req,res) => res.json({ status:'ok', service:'collabspace-api', timestamp:new Date().toISOString() }));
app.post('/api/auth/register', authLimiter, asyncRoute(async(req,res) => {
 const parsed = z.object({ name:z.string().trim().min(2).max(80), email:z.string().trim().email(), password:z.string().min(8).max(128) }).parse(req.body);
 const email = parsed.email.toLowerCase();
 const passwordHash = await bcrypt.hash(parsed.password,12);
 const { user, workspace } = await prisma.$transaction(async tx => {
  const user = await tx.user.create({data:{name:parsed.name,email,passwordHash},select:{id:true,name:true,email:true,avatarUrl:true}});
  const workspace = await tx.workspace.create({data:{name:`${parsed.name.split(' ')[0]}'s workspace`,slug:slugify(parsed.name),ownerId:user.id,members:{create:{userId:user.id,role:'OWNER'}}}});
  return {user,workspace};
 });
 const token = jwt.sign({id:user.id,email:user.email},SECRET,{expiresIn:'7d'});
 res.status(201).json({token,user:{id:user.id,name:user.name,email:user.email,avatarUrl:user.avatarUrl},workspace});
}));
app.post('/api/auth/login', authLimiter, asyncRoute(async(req,res) => {
 const parsed=z.object({email:z.string().trim().email(),password:z.string().min(1).max(128)}).parse(req.body);
 const data={...parsed,email:parsed.email.toLowerCase()};
 const user=await prisma.user.findUnique({where:{email:data.email}});
 if(!user || !(await bcrypt.compare(data.password,user.passwordHash))) return res.status(401).json({error:'Email or password is incorrect'});
 const token=jwt.sign({id:user.id,email:user.email},SECRET,{expiresIn:'7d'});
 const workspace=await prisma.workspace.findFirst({where:{members:{some:{userId:user.id}}}});
 res.json({token,user:{id:user.id,name:user.name,email:user.email,avatarUrl:user.avatarUrl},workspace});
}));
app.get('/api/me',auth,asyncRoute(async(req,res)=>{const user=await prisma.user.findUnique({where:{id:req.user!.id},select:{id:true,name:true,email:true,avatarUrl:true,createdAt:true}});res.json(user)}));
app.patch('/api/me/avatar',auth,asyncRoute(async(req,res)=>{
 const data=z.object({avatarUrl:z.string().max(700_000).nullable()}).parse(req.body);
 if(data.avatarUrl!==null&&!isValidProfileAvatarDataUrl(data.avatarUrl))return res.status(400).json({error:'Upload a valid PNG, JPEG, or WebP image smaller than 512 KB.'});
 const user=await prisma.user.update({where:{id:req.user!.id},data:{avatarUrl:data.avatarUrl},select:{id:true,name:true,email:true,avatarUrl:true}});
 res.json(user);
}));
app.get('/api/workspaces',auth,asyncRoute(async(req,res)=>{const rows=await prisma.workspace.findMany({where:{members:{some:{userId:req.user!.id}}},include:{_count:{select:{members:true,projects:true,documents:true}}}});res.json(rows)}));
app.post('/api/workspaces',auth,asyncRoute(async(req,res)=>{const name=z.string().min(2).max(80).parse(req.body.name);const row=await prisma.workspace.create({data:{name,slug:slugify(name),ownerId:req.user!.id,members:{create:{userId:req.user!.id,role:'OWNER'}}}});res.status(201).json(row)}));
app.get('/api/workspaces/:id/overview',auth,asyncRoute(async(req,res)=>{const w=await prisma.workspace.findFirst({where:{id:req.params.id,members:{some:{userId:req.user!.id}}},include:{members:{include:{user:{select:{id:true,name:true,email:true}}}},projects:{include:{_count:{select:{tasks:true}}}},tasks:{orderBy:{createdAt:'desc'},take:30,include:{assignee:{select:{id:true,name:true}}}},documents:{orderBy:{updatedAt:'desc'},take:12},channels:{include:{_count:{select:{messages:true}}}},events:{orderBy:{startsAt:'asc'},take:10}}});if(!w)return res.status(404).json({error:'Workspace not found'});res.json(w)}));
app.get('/api/workspaces/:id/channels',auth,asyncRoute(async(req,res)=>{const member=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});if(!member)return res.status(404).json({error:'Workspace not found'});const channels=await prisma.channel.findMany({where:{workspaceId:req.params.id},orderBy:{name:'asc'},include:{messages:{orderBy:{createdAt:'asc'},take:100,include:{author:{select:{id:true,name:true}}}}}});res.json(channels)}));
app.post('/api/workspaces/:id/projects',auth,asyncRoute(async(req,res)=>{if(!await hasWorkspaceWriteAccess(req.user!.id,req.params.id))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({name:z.string().min(1),description:z.string().optional()}).parse(req.body);res.status(201).json(await prisma.project.create({data:{...d,workspaceId:req.params.id}}))}));
app.patch('/api/projects/:id',auth,asyncRoute(async(req,res)=>{const p=await prisma.project.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!p)return res.status(404).json({error:'Project not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,p.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({name:z.string().trim().min(1).max(120).optional(),description:z.string().max(3000).optional(),status:z.enum(['ACTIVE','ON_HOLD','COMPLETED','ARCHIVED']).optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()}).parse(req.body);res.json(await prisma.project.update({where:{id:p.id},data:d}))}));
app.delete('/api/projects/:id',auth,asyncRoute(async(req,res)=>{const p=await prisma.project.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!p)return res.status(404).json({error:'Project not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,p.workspaceId))return res.status(403).json({error:'Workspace write access denied'});await prisma.project.delete({where:{id:p.id}});res.status(204).end()}));
app.post('/api/workspaces/:id/tasks',auth,asyncRoute(async(req,res)=>{if(!await hasWorkspaceWriteAccess(req.user!.id,req.params.id))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({title:z.string().min(1),description:z.string().optional(),status:z.enum(['BACKLOG','TODO','IN_PROGRESS','REVIEW','DONE']).optional(),priority:z.enum(['LOW','MEDIUM','HIGH','URGENT']).optional(),dueDate:z.string().datetime().optional(),projectId:z.string().optional()}).parse(req.body);if(d.projectId){const project=await prisma.project.findFirst({where:{id:d.projectId,workspaceId:req.params.id}});if(!project)return res.status(400).json({error:'Project must belong to this workspace.'});}const task=await prisma.task.create({data:{...d,dueDate:d.dueDate?new Date(d.dueDate):undefined,workspaceId:req.params.id}});io.to(`workspace:${req.params.id}`).emit('task:created',task);res.status(201).json(task)}));
app.patch('/api/tasks/:id',auth,asyncRoute(async(req,res)=>{const task=await prisma.task.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!task)return res.status(404).json({error:'Task not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,task.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({title:z.string().min(1).optional(),description:z.string().optional(),status:z.enum(['BACKLOG','TODO','IN_PROGRESS','REVIEW','DONE']).optional(),priority:z.enum(['LOW','MEDIUM','HIGH','URGENT']).optional(),assigneeId:z.string().nullable().optional(),dueDate:z.string().datetime().nullable().optional()}).parse(req.body);if(d.assigneeId){const assignee=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:d.assigneeId,workspaceId:task.workspaceId}}});if(!assignee)return res.status(400).json({error:'Assignee must be a member of this workspace.'});}const updated=await prisma.task.update({where:{id:task.id},data:{...d,dueDate:d.dueDate?new Date(d.dueDate):d.dueDate}});io.to(`workspace:${task.workspaceId}`).emit('task:updated',updated);res.json(updated)}));
app.delete('/api/tasks/:id',auth,asyncRoute(async(req,res)=>{const t=await prisma.task.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!t)return res.status(404).json({error:'Task not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,t.workspaceId))return res.status(403).json({error:'Workspace write access denied'});await prisma.task.delete({where:{id:t.id}});res.status(204).end()}));
app.post('/api/workspaces/:id/documents',auth,asyncRoute(async(req,res)=>{if(!await hasWorkspaceWriteAccess(req.user!.id,req.params.id))return res.status(403).json({error:'Workspace write access denied'});const title=z.string().min(1).max(160).parse(req.body.title||'Untitled');res.status(201).json(await prisma.document.create({data:{title,workspaceId:req.params.id,content:{type:'doc',content:[{type:'paragraph'}]}}}))}));
app.get('/api/documents/:id',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}},include:{comments:{include:{author:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'}},versions:{orderBy:{createdAt:'desc'},take:20}}});if(!d)return res.status(404).json({error:'Document not found'});res.json(d)}));
app.patch('/api/documents/:id',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!d)return res.status(404).json({error:'Document not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,d.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const data=z.object({title:z.string().min(1).optional(),content:z.unknown().optional()}).parse(req.body);const updated=await prisma.document.update({where:{id:d.id},data:{...(data.title?{title:data.title}:{}),...(data.content!==undefined?{content:data.content as any}:{})}});res.json(updated)}));
app.post('/api/documents/:id/versions',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!d)return res.status(404).json({error:'Document not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,d.workspaceId))return res.status(403).json({error:'Workspace write access denied'});res.status(201).json(await prisma.documentVersion.create({data:{documentId:d.id,snapshot:(d.content??{}) as any}}))}));
app.post('/api/documents/:id/versions/:versionId/restore',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!d)return res.status(404).json({error:'Document not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,d.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const version=await prisma.documentVersion.findFirst({where:{id:req.params.versionId,documentId:d.id}});if(!version)return res.status(404).json({error:'Version not found'});await prisma.documentVersion.create({data:{documentId:d.id,snapshot:d.content??{}}});const restored=await prisma.document.update({where:{id:d.id},data:{content:version.snapshot as any}});res.json(restored)}));
app.post('/api/documents/:id/comments',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!d)return res.status(404).json({error:'Document not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,d.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const body=z.string().min(1).max(3000).parse(req.body.body);res.status(201).json(await prisma.comment.create({data:{documentId:d.id,authorId:req.user!.id,body},include:{author:{select:{id:true,name:true}}}}))}));
app.get('/api/search',auth,asyncRoute(async(req,res)=>{const q=String(req.query.q||'').trim();if(q.length<2)return res.json({documents:[],tasks:[],projects:[]});const member=await prisma.workspaceMember.findMany({where:{userId:req.user!.id},select:{workspaceId:true}});const ids=member.map(x=>x.workspaceId);const [documents,tasks,projects]=await Promise.all([prisma.document.findMany({where:{workspaceId:{in:ids},title:{contains:q,mode:'insensitive'}},take:8}),prisma.task.findMany({where:{workspaceId:{in:ids},title:{contains:q,mode:'insensitive'}},take:8}),prisma.project.findMany({where:{workspaceId:{in:ids},name:{contains:q,mode:'insensitive'}},take:8})]);res.json({documents,tasks,projects})}));


// Workspace invitations: tokens are single-use and expire after seven days.
app.post('/api/workspaces/:id/invitations',auth,asyncRoute(async(req,res)=>{
 const data=z.object({email:z.string().email(),role:z.enum(['ADMIN','EDITOR','VIEWER']).default('EDITOR')}).parse(req.body);
 const member=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});
 if(!member||!['OWNER','ADMIN'].includes(member.role))return res.status(403).json({error:'Only workspace owners and admins can invite members.'});
 const email=data.email.toLowerCase();
 const existing=await prisma.workspaceMember.findFirst({where:{workspaceId:req.params.id,user:{email}}});
 if(existing)return res.status(409).json({error:'This person is already a workspace member.'});
 const invitation=await prisma.workspaceInvitation.create({data:{email,role:data.role,token:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+7*86400000),workspaceId:req.params.id,invitedById:req.user!.id}});
 res.status(201).json({id:invitation.id,email:invitation.email,role:invitation.role,token:invitation.token,expiresAt:invitation.expiresAt,delivery:'Copy this invitation token and share it securely. Configure an email provider to send invitations automatically.'});
}));
app.post('/api/invitations/accept',auth,asyncRoute(async(req,res)=>{
 const token=z.string().min(32).max(128).parse(req.body.token);
 const invite=await prisma.workspaceInvitation.findUnique({where:{token}});
 if(!invite||invite.acceptedAt||invite.expiresAt<new Date())return res.status(400).json({error:'Invitation is invalid, expired, or already used.'});
 const user=await prisma.user.findUnique({where:{id:req.user!.id}});
 if(!user||user.email.toLowerCase()!==invite.email)return res.status(403).json({error:'Sign in with the email address this invitation was sent to.'});
 const existingMembership=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:user.id,workspaceId:invite.workspaceId}}});
 if(existingMembership)await invalidateWorkspaceAccess(invite.workspaceId,user.id);
 await prisma.$transaction([prisma.workspaceMember.upsert({where:{userId_workspaceId:{userId:user.id,workspaceId:invite.workspaceId}},create:{userId:user.id,workspaceId:invite.workspaceId,role:invite.role},update:{role:invite.role}}),prisma.workspaceInvitation.update({where:{id:invite.id},data:{acceptedAt:new Date()}})]);
 if(existingMembership)await invalidateWorkspaceAccess(invite.workspaceId,user.id);
 res.json({ok:true,workspaceId:invite.workspaceId});
}));
app.patch('/api/workspaces/:id/members/:userId',auth,asyncRoute(async(req,res)=>{
 const actor=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});
 if(!actor||actor.role!=='OWNER')return res.status(403).json({error:'Only the workspace owner can change member roles.'});
 const role=z.enum(['ADMIN','EDITOR','VIEWER']).parse(req.body.role);
 const target=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.params.userId,workspaceId:req.params.id}},include:{workspace:{select:{ownerId:true}}}});
 if(!target)return res.status(404).json({error:'Member not found'});
 if(target.role==='OWNER'||target.userId===target.workspace.ownerId)return res.status(403).json({error:'The workspace owner role cannot be changed.'});
 await invalidateWorkspaceAccess(req.params.id,target.userId);
 const updated=await prisma.workspaceMember.update({where:{id:target.id},data:{role}});
 await invalidateWorkspaceAccess(req.params.id,target.userId);
 res.json(updated);
}));
app.delete('/api/workspaces/:id/members/:userId',auth,asyncRoute(async(req,res)=>{
 const actor=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});
 if(!actor||!['OWNER','ADMIN'].includes(actor.role))return res.status(403).json({error:'Insufficient workspace permissions.'});
 if(req.params.userId===req.user!.id)return res.status(400).json({error:'You cannot remove yourself using this endpoint.'});
 const target=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.params.userId,workspaceId:req.params.id}},include:{workspace:{select:{ownerId:true}}}});
 if(!target)return res.status(404).json({error:'Member not found'});
 if(!canRemoveWorkspaceMember(actor.role,target.role,target.userId===target.workspace.ownerId))return res.status(403).json({error:target.role==='OWNER'||target.userId===target.workspace.ownerId?'The workspace owner cannot be removed.':'Insufficient workspace permissions.'});
 await invalidateWorkspaceAccess(req.params.id,target.userId);
 await prisma.workspaceMember.delete({where:{id:target.id}});
 await invalidateWorkspaceAccess(req.params.id,target.userId);
 res.status(204).end();
}));
// Persistent calendar events.
app.post('/api/workspaces/:id/events',auth,asyncRoute(async(req,res)=>{
 if(!await hasWorkspaceWriteAccess(req.user!.id,req.params.id))return res.status(403).json({error:'Workspace write access denied'});
 const d=z.object({title:z.string().trim().min(1).max(160),startsAt:z.string().datetime(),endsAt:z.string().datetime().optional(),description:z.string().max(2000).optional()}).parse(req.body);
 if(d.endsAt&&new Date(d.endsAt)<=new Date(d.startsAt))return res.status(400).json({error:'Event end must be after its start.'});
 const event=await prisma.calendarEvent.create({data:{title:d.title,description:d.description||'',startsAt:new Date(d.startsAt),endsAt:d.endsAt?new Date(d.endsAt):null,workspaceId:req.params.id}});io.to(`workspace:${req.params.id}`).emit('event:created',event);res.status(201).json(event);
}));
app.patch('/api/events/:id',auth,asyncRoute(async(req,res)=>{
 const event=await prisma.calendarEvent.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!event)return res.status(404).json({error:'Event not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,event.workspaceId))return res.status(403).json({error:'Workspace write access denied'});
 const d=z.object({title:z.string().trim().min(1).max(160).optional(),description:z.string().max(2000).optional(),startsAt:z.string().datetime().optional(),endsAt:z.string().datetime().nullable().optional()}).parse(req.body);
 const start=d.startsAt?new Date(d.startsAt):event.startsAt;const end=d.endsAt===undefined?event.endsAt:d.endsAt?new Date(d.endsAt):null;if(end&&end<=start)return res.status(400).json({error:'Event end must be after its start.'});
 const updated=await prisma.calendarEvent.update({where:{id:event.id},data:{...d,startsAt:start,endsAt:end}});io.to(`workspace:${event.workspaceId}`).emit('event:updated',updated);res.json(updated);
}));
app.delete('/api/events/:id',auth,asyncRoute(async(req,res)=>{const e=await prisma.calendarEvent.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!e)return res.status(404).json({error:'Event not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,e.workspaceId))return res.status(403).json({error:'Workspace write access denied'});await prisma.calendarEvent.delete({where:{id:e.id}});io.to(`workspace:${e.workspaceId}`).emit('event:deleted',{id:e.id});res.status(204).end()}));
// Whiteboard documents persist their normalized object graph as JSON; clients broadcast transient cursor updates over Socket.IO.
app.get('/api/workspaces/:id/whiteboards',auth,asyncRoute(async(req,res)=>{const m=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});if(!m)return res.status(403).json({error:'Workspace access denied'});res.json(await prisma.whiteboard.findMany({where:{workspaceId:req.params.id},orderBy:{updatedAt:'desc'}}))}));
app.post('/api/workspaces/:id/whiteboards',auth,asyncRoute(async(req,res)=>{if(!await hasWorkspaceWriteAccess(req.user!.id,req.params.id))return res.status(403).json({error:'Workspace write access denied'});const title=z.string().trim().min(1).max(160).default('Untitled whiteboard').parse(req.body.title);res.status(201).json(await prisma.whiteboard.create({data:{title,workspaceId:req.params.id,state:{elements:[]}}}))}));
app.get('/api/whiteboards/:id',auth,asyncRoute(async(req,res)=>{const b=await prisma.whiteboard.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!b)return res.status(404).json({error:'Whiteboard not found'});res.json(b)}));
app.put('/api/whiteboards/:id',auth,asyncRoute(async(req,res)=>{const b=await prisma.whiteboard.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!b)return res.status(404).json({error:'Whiteboard not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,b.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({title:z.string().min(1).max(160).optional(),state:z.unknown()}).parse(req.body);if(JSON.stringify(d.state).length>2_000_000)return res.status(413).json({error:'Whiteboard state exceeds 2 MB.'});const updated=await prisma.whiteboard.update({where:{id:b.id},data:{...(d.title?{title:d.title}:{}),state:d.state as any}});io.to(`whiteboard:${b.id}`).emit('whiteboard:updated',{id:b.id,state:updated.state,updatedAt:updated.updatedAt});res.json(updated)}));
app.delete('/api/whiteboards/:id',auth,asyncRoute(async(req,res)=>{const b=await prisma.whiteboard.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!b)return res.status(404).json({error:'Whiteboard not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,b.workspaceId))return res.status(403).json({error:'Workspace write access denied'});await prisma.whiteboard.delete({where:{id:b.id}});res.status(204).end()}));
app.post('/api/workspaces/:id/channels',auth,asyncRoute(async(req,res)=>{const m=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:req.params.id}}});if(!m||!['OWNER','ADMIN'].includes(m.role))return res.status(403).json({error:'Only workspace admins can create channels.'});const name=z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/i).parse(req.body.name);res.status(201).json(await prisma.channel.create({data:{name,workspaceId:req.params.id}}))}));
app.patch('/api/comments/:id',auth,asyncRoute(async(req,res)=>{const c=await prisma.comment.findFirst({where:{id:req.params.id,document:{workspace:{members:{some:{userId:req.user!.id}}}}},include:{document:{select:{workspaceId:true}}}});if(!c)return res.status(404).json({error:'Comment not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,c.document.workspaceId))return res.status(403).json({error:'Workspace write access denied'});const d=z.object({body:z.string().min(1).max(3000).optional(),resolved:z.boolean().optional()}).parse(req.body);if(d.body&&c.authorId!==req.user!.id)return res.status(403).json({error:'Only the author can edit a comment.'});res.json(await prisma.comment.update({where:{id:c.id},data:d}))}));
app.delete('/api/comments/:id',auth,asyncRoute(async(req,res)=>{const c=await prisma.comment.findFirst({where:{id:req.params.id,document:{workspace:{members:{some:{userId:req.user!.id}}}}},include:{document:{select:{workspaceId:true}}}});if(!c)return res.status(404).json({error:'Comment not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,c.document.workspaceId))return res.status(403).json({error:'Workspace write access denied'});if(c.authorId!==req.user!.id)return res.status(403).json({error:'Only the author can delete a comment.'});await prisma.comment.delete({where:{id:c.id}});res.status(204).end()}));
app.delete('/api/documents/:id',auth,asyncRoute(async(req,res)=>{const d=await prisma.document.findFirst({where:{id:req.params.id,workspace:{members:{some:{userId:req.user!.id}}}}});if(!d)return res.status(404).json({error:'Document not found'});if(!await hasWorkspaceWriteAccess(req.user!.id,d.workspaceId))return res.status(403).json({error:'Workspace write access denied'});await prisma.document.delete({where:{id:d.id}});res.status(204).end()}));
app.get('/api/notifications',auth,asyncRoute(async(req,res)=>{const rows=await prisma.notification.findMany({where:{userId:req.user!.id,workspace:{members:{some:{userId:req.user!.id}}}},orderBy:{createdAt:'desc'},take:50});res.json(rows)}));
app.patch('/api/notifications/:id/read',auth,asyncRoute(async(req,res)=>{const n=await prisma.notification.findFirst({where:{id:req.params.id,userId:req.user!.id}});if(!n)return res.status(404).json({error:'Notification not found'});res.json(await prisma.notification.update({where:{id:n.id},data:{readAt:new Date()}}))}));
app.post('/api/notifications/read-all',auth,asyncRoute(async(req,res)=>{await prisma.notification.updateMany({where:{userId:req.user!.id,readAt:null},data:{readAt:new Date()}});res.json({ok:true})}));

app.post('/api/ai/chat',auth,asyncRoute(async(req,res)=>{
 const input=z.object({message:z.string().min(1).max(6000),workspaceId:z.string().optional(),documentId:z.string().optional()}).parse(req.body);
 const apiKey=process.env.OPENAI_API_KEY;
 if(!apiKey)return res.status(503).json({error:'AI is not configured. Add OPENAI_API_KEY to the server .env file and restart CollabSpace.'});
 let context='';
 if(input.workspaceId){
  const membership=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:req.user!.id,workspaceId:input.workspaceId}}});
  if(!membership)return res.status(403).json({error:'Workspace access denied'});
  const docs=await prisma.document.findMany({where:{workspaceId:input.workspaceId},select:{title:true,content:true},take:12,orderBy:{updatedAt:'desc'}});
  context=docs.map(d=>`${d.title}: ${JSON.stringify(d.content).slice(0,5000)}`).join('\n\n').slice(0,18000);
 }
 const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.4,messages:[{role:'system',content:'You are Collab AI, a concise and practical productivity assistant. Use the supplied workspace context only as reference; do not claim access to information not present.'},{role:'user',content:`Workspace context:\n${context||'No workspace context supplied.'}\n\nRequest:\n${input.message}`} ]})});
 const payload=await response.json() as {choices?:{message?:{content?:string}}[];error?:{message?:string}};
 if(!response.ok)return res.status(502).json({error:payload.error?.message||'The AI provider request failed.'});
 res.json({answer:payload.choices?.[0]?.message?.content||'I could not generate a response.'});
}));

app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(err instanceof z.ZodError)return res.status(400).json({error:'Validation failed',details:err.flatten()});const errorCode=(err as {code?:string}|null)?.code;if(errorCode==='P2002')return res.status(409).json({error:'An account or resource with this value already exists.'});console.error(err);res.status(500).json({error:'Something went wrong. Check server logs.'})});

const io=new Server(httpServer,{cors:{origin:(process.env.WEB_ORIGIN||'http://localhost:3000').split(','),credentials:true}});
function disconnectRealtimeUser(userId:string) {
 for(const socket of io.sockets.sockets.values()) {
  const identity=socket.data.user as {id?:string}|undefined;
  if(identity?.id===userId)socket.disconnect(true);
 }
}
io.use((socket,next)=>{try{const token=socket.handshake.auth.token as string;if(!token)throw new Error('Missing token');socket.data.user=jwt.verify(token,SECRET);next()}catch{next(new Error('Unauthorized'))}});
io.on('connection',socket=>{
 const user=socket.data.user as {id:string;name?:string};
 socket.on('workspace:join',async(workspaceId:string)=>{try{const member=await prisma.workspaceMember.findUnique({where:{userId_workspaceId:{userId:user.id,workspaceId}}});if(!member)return;socket.join(`workspace:${workspaceId}`);socket.to(`workspace:${workspaceId}`).emit('presence:joined',{userId:user.id,socketId:socket.id});}catch(error){console.error('workspace:join failed',error)}});
 socket.on('document:join',async(documentId:string)=>{try{const doc=await prisma.document.findFirst({where:{id:documentId,workspace:{members:{some:{userId:user.id}}}}});if(doc)socket.join(`document:${documentId}`)}catch(error){console.error('document:join failed',error)}});
 socket.on('whiteboard:join',async(id:string)=>{try{const board=await prisma.whiteboard.findFirst({where:{id,workspace:{members:{some:{userId:user.id}}}},select:{id:true}});if(board)socket.join(`whiteboard:${id}`)}catch(error){console.error('whiteboard:join failed',error)}});
 socket.on('whiteboard:cursor',(payload:{id:string;x:number;y:number})=>{if(payload&&typeof payload.id==='string'&&Number.isFinite(payload.x)&&Number.isFinite(payload.y))socket.to(`whiteboard:${payload.id}`).emit('whiteboard:cursor',{userId:user.id,x:payload.x,y:payload.y})});
 socket.on('channel:join',async(channelId:string)=>{try{const channel=await prisma.channel.findFirst({where:{id:channelId,workspace:{members:{some:{userId:user.id}}}},select:{id:true}});if(channel){const previous=socket.data.channelId as string|undefined;if(previous)socket.leave(`channel:${previous}`);socket.data.channelId=channel.id;socket.join(`channel:${channel.id}`)}}catch(error){console.error('channel:join failed',error)}});
 socket.on('chat:send',async(payload:{channelId:string;body:string},ack?:(result:{ok:boolean;error?:string})=>void)=>{try{const body=typeof payload?.body==='string'?payload.body.trim():'';if(!body||body.length>5000){ack?.({ok:false,error:'Message must contain 1–5000 characters.'});return}const channel=await prisma.channel.findFirst({where:{id:payload.channelId,workspace:{members:{some:{userId:user.id}}}}});if(!channel){ack?.({ok:false,error:'Channel not found or access denied.'});return}if(!await hasWorkspaceWriteAccess(user.id,channel.workspaceId)){ack?.({ok:false,error:'Workspace write access denied.'});return}const message=await prisma.message.create({data:{channelId:channel.id,authorId:user.id,body},include:{author:{select:{id:true,name:true}}}});io.to(`channel:${channel.id}`).emit('chat:message',message);ack?.({ok:true})}catch(error){console.error('chat:send failed',error);ack?.({ok:false,error:'Message could not be sent.'})}});
 socket.on('disconnect',()=>{socket.broadcast.emit('presence:left',{userId:user.id,socketId:socket.id})});
});
httpServer.listen(PORT,()=>console.log(`CollabSpace API + realtime gateway listening on :${PORT}`));
