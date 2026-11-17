import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
if (process.env.NODE_ENV === 'production') {
 throw new Error('The demo seed is disabled in production.');
}
const db=new PrismaClient();
async function main(){
 const passwordHash=await bcrypt.hash('CollabSpace2026!',12);
 const user=await db.user.upsert({where:{email:'demo@collabspace.local'},update:{},create:{name:'Alex Morgan',email:'demo@collabspace.local',passwordHash}});
 let workspace=await db.workspace.findFirst({where:{ownerId:user.id}});
 if(!workspace) workspace=await db.workspace.create({data:{name:'Acme Studio',slug:'acme-studio-demo',ownerId:user.id,members:{create:{userId:user.id,role:'OWNER'}}}});
 if(await db.project.count({where:{workspaceId:workspace.id}})===0){
  const p=await db.project.create({data:{name:'Website redesign',description:'Refresh the customer experience across the marketing site.',workspaceId:workspace.id}});
  await db.task.createMany({data:[{title:'Map the current user journey',status:'DONE',priority:'HIGH',workspaceId:workspace.id,projectId:p.id},{title:'Create updated design system',status:'IN_PROGRESS',priority:'URGENT',workspaceId:workspace.id,projectId:p.id},{title:'Review onboarding flow',status:'TODO',priority:'MEDIUM',workspaceId:workspace.id,projectId:p.id},{title:'Prepare launch checklist',status:'BACKLOG',priority:'LOW',workspaceId:workspace.id,projectId:p.id}]});
  await db.document.createMany({data:[{title:'Product strategy',workspaceId:workspace.id,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Our north star is to make team collaboration feel effortless.'}]}]}},{title:'Weekly team sync',workspaceId:workspace.id,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Wins, blockers, and priorities for this week.'}]}]}}]});
 }
 if(await db.channel.count({where:{workspaceId:workspace.id}})===0){ const channel=await db.channel.create({data:{name:'general',workspaceId:workspace.id}}); await db.message.create({data:{channelId:channel.id,authorId:user.id,body:'Welcome to Acme Studio! Use this channel to share updates, ask questions, and keep work moving.'}}); }
 if(await db.whiteboard.count({where:{workspaceId:workspace.id}})===0) await db.whiteboard.create({data:{title:'Product brainstorm',workspaceId:workspace.id,state:{elements:[{id:'idea-1',type:'sticky',x:100,y:100,text:'Understand customer needs',color:'#fff0c2'},{id:'idea-2',type:'sticky',x:360,y:180,text:'Explore simple solutions',color:'#dff3e9'},{id:'idea-3',type:'sticky',x:620,y:100,text:'Ship, measure, learn',color:'#e8e4ff'}]}}});
 if(await db.calendarEvent.count({where:{workspaceId:workspace.id}})===0) await db.calendarEvent.createMany({data:[{title:'Product direction review',startsAt:new Date(Date.now()+86400000),workspaceId:workspace.id},{title:'Design critique',startsAt:new Date(Date.now()+3*86400000),workspaceId:workspace.id}]});
 console.log('Seed complete. Demo login: demo@collabspace.local / CollabSpace2026!');
}
main().finally(()=>db.$disconnect());
