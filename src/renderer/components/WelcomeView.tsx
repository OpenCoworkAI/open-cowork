import { useState, useRef, useEffect } from 'react';
import { useIPC } from '../hooks/useIPC';
import {
  FileText,
  BarChart3,
  FolderOpen,
  ArrowRight,
  Plus,
  Mail,
  Chrome,
} from 'lucide-react';

export function WelcomeView() {
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startSession, selectFolder } = useIPC();

  const handleSelectFolder = async () => {
    const folder = await selectFolder();
    if (folder) {
      setCwd(folder);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if (!currentPrompt.trim() || isSubmitting) return;

    // Security: Require a working directory to be selected
    if (!cwd) {
      // Prompt user to select a folder first
      const folder = await selectFolder();
      if (!folder) {
        return; // User cancelled folder selection
      }
      setCwd(folder);
      // Continue with the selected folder
      setIsSubmitting(true);
      try {
        const sessionTitle = currentPrompt.slice(0, 50) + (currentPrompt.length > 50 ? '...' : '');
        await startSession(sessionTitle, currentPrompt, folder);
        setPrompt('');
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const sessionTitle = currentPrompt.slice(0, 50) + (currentPrompt.length > 50 ? '...' : '');
      await startSession(sessionTitle, currentPrompt, cwd);
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTagClick = (tag: string, tagPrompt: string) => {
    setSelectedTag(tag === selectedTag ? null : tag);
    if (tag !== selectedTag) {
      setPrompt(tagPrompt);
      if (textareaRef.current) {
        textareaRef.current.value = tagPrompt;
        // Trigger height adjustment
        adjustTextareaHeight();
      }
    }
  };

  // Auto-adjust textarea height based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set max height to 200px (about 8 lines), then scroll
      const maxHeight = 200;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      // Show scrollbar if content exceeds max height
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  };

  // Adjust height when prompt changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  const quickTags = [
    { id: 'create', label: 'Create a file', icon: FileText, prompt: 'Create a new file for me' },
    { id: 'crunch', label: 'Crunch data', icon: BarChart3, prompt: 'Help me analyze and process data' },
    { id: 'organize', label: 'Organize files', icon: FolderOpen, prompt: 'Help me organize my files and folders' },
    { 
      id: 'email', 
      label: 'Check emails', 
      icon: Mail, 
      prompt: 'Help me use Chrome to summarize the new emails from the past three days in my Gmail and NetEase Mail. Note that the saved accounts already include the full email suffix. Therefore, if the email suffix is already pre-filled on the webpage or in a screenshot, do not enter it again, to avoid login failure. Also, first check whether the corresponding account credentials are saved. If the username or password for a given email service is not saved, you can skip that email account.',
      requiresChrome: true 
    },
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-6 animate-fade-in">
        {/* Quick Action Tags */}
        <div className="flex flex-wrap gap-2 justify-center">
          {quickTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag.id, tag.prompt)}
              className={`tag ${selectedTag === tag.id ? 'tag-active' : ''} ${
                'requiresChrome' in tag && tag.requiresChrome ? 'relative' : ''
              }`}
            >
              <tag.icon className={`w-4 h-4 ${selectedTag === tag.id ? 'text-accent' : 'text-text-muted'}`} />
              <span>{tag.label}</span>
              {'requiresChrome' in tag && tag.requiresChrome && (
                <span className="flex items-center gap-1 ml-1.5 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  <Chrome className="w-3 h-3" />
                  <span>Chrome</span>
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main Input Card - Right aligned */}
        <form onSubmit={handleSubmit} className="card p-4 space-y-4">
          {/* Text Input - Auto-resizing */}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              adjustTextareaHeight();
            }}
            placeholder="How can I help you today?"
            rows={1}
            style={{ minHeight: '72px', maxHeight: '200px' }}
            className="w-full resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-base leading-relaxed overflow-hidden"
            onKeyDown={(e) => {
              // Enter to send, Shift+Enter for new line
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <button
              type="button"
              onClick={handleSelectFolder}
              className={`flex items-center gap-2 text-sm transition-colors ${
                cwd
                  ? 'text-text-secondary hover:text-text-primary'
                  : 'text-accent hover:text-accent-hover'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              <span>{cwd ? cwd.split(/[/\\]/).pop() : 'Select Working Folder (required)'}</span>
              <Plus className="w-3 h-3" />
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary px-5 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isSubmitting ? 'Starting...' : "Let's go"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
