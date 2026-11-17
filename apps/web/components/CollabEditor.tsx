'use client';

import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Underline from '@tiptap/extension-underline';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { COLLAB_URL } from '@/lib/config';

type Props = {
  room?: string;
  token: string;
  initialText: string;
  userName?: string;
  onLocalChange: (text: string) => void;
};

export default function CollabEditor({ room, token, initialText, userName = 'Workspace member', onLocalChange }: Props) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [status, setStatus] = useState('Offline');
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!room || !token) return;
    const doc = new Y.Doc();
    const p = new WebsocketProvider(COLLAB_URL, room, doc, { params: { token }, connect: true });
    const onStatus = (event: { status: string }) => setStatus(event.status === 'connected' ? 'Connected · syncing' : 'Reconnecting…');
    const onSynced = (value: boolean) => {
      setSynced(value);
      if (value) setStatus('Live collaboration');
    };
    p.on('status', onStatus);
    p.on('sync', onSynced);
    setYdoc(doc);
    setProvider(p);
    return () => {
      p.off('status', onStatus);
      p.off('sync', onSynced);
      p.destroy();
      doc.destroy();
      setProvider(null);
      setYdoc(null);
      setSynced(false);
    };
  }, [room, token]);

  const editor = useEditor({
    extensions: ydoc && provider ? [
      StarterKit.configure({ undoRedo: false }),
      Underline,
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name: userName, color: '#7969e8' } }),
    ] : [],
    editorProps: { attributes: { class: 'tiptap-editor-content', spellcheck: 'true' } },
    immediatelyRender: false,
  }, [ydoc, provider, userName]);

  useEffect(() => {
    if (!editor) return;
    const applyFormat = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      const chain = editor.chain().focus();
      if (command === 'bold') chain.toggleBold().run();
      else if (command === 'italic') chain.toggleItalic().run();
      else if (command === 'underline') chain.toggleUnderline().run();
      else if (command === 'h1') chain.toggleHeading({ level: 1 }).run();
      else if (command === 'h2') chain.toggleHeading({ level: 2 }).run();
      else if (command === 'bullet') chain.toggleBulletList().run();
      else if (command === 'quote') chain.toggleBlockquote().run();
    };
    window.addEventListener('collabspace:format', applyFormat);
    return () => window.removeEventListener('collabspace:format', applyFormat);
  }, [editor]);

  // Initialize a newly-created shared Yjs fragment from the document's initial text.
  // Existing shared content is never overwritten when another collaborator joins.
  useEffect(() => {
    if (!editor || !ydoc || !provider || !synced || !initialText.trim()) return;
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length === 0) {
      const paragraphs = initialText.split(/\n{2,}/).map(text => ({
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : undefined,
      }));
      editor.commands.setContent({ type: 'doc', content: paragraphs });
    }
  }, [editor, ydoc, provider, synced, initialText]);

  if (!editor || !ydoc || !provider) {
    return <div className="editor-fallback">
      <textarea className="rich-editor" value={initialText} onChange={event => onLocalChange(event.target.value)} />
      <small>{token ? 'Connecting to live collaboration…' : 'Local preview · Sign in and open a saved document to collaborate live.'}</small>
    </div>;
  }

  return <div className="collab-editor-wrap">
    <div className="collab-status"><i /> {status}</div>
    <EditorContent editor={editor} />
  </div>;
}
