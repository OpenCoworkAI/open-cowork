import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useFileAttachments } from '../hooks/useFileAttachments';
import type { ContentBlock } from '../types';
import {
  FileText,
  BarChart3,
  FolderOpen,
  ArrowRight,
  Mail,
  Chrome,
  X,
  Paperclip,
  BookOpen,
  FileSearch,
  Target,
  Briefcase,
  GraduationCap,
  MessageSquare,
} from 'lucide-react';
import CoeadaptLogo from '../assets/logo-full-1.png';

export function WelcomeView() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [activeCareerCategory, setActiveCareerCategory] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startSession, changeWorkingDir, isElectron } = useIPC();
  const {
    pastedImages, attachedFiles, isDragging,
    handlePaste, handleDragOver, handleDragLeave, handleDrop,
    handleFileSelect, removeImage, removeFile, clearAll,
  } = useFileAttachments(isElectron);
  const workingDir = useAppStore((state) => state.workingDir);

  const handleSelectFolder = async () => {
    await changeWorkingDir();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if ((!currentPrompt.trim() && pastedImages.length === 0 && attachedFiles.length === 0) || isSubmitting) return;

    // Build content blocks
    const contentBlocks: ContentBlock[] = [];

    // Add images first
    pastedImages.forEach(img => {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType as any,
          data: img.base64,
        },
      });
    });

    // Add file attachments
    attachedFiles.forEach(file => {
      contentBlocks.push({
        type: 'file_attachment',
        filename: file.name,
        relativePath: file.path,
        size: file.size,
        mimeType: file.type,
        inlineDataBase64: file.inlineDataBase64,
      });
    });

    // Add text if present
    if (currentPrompt.trim()) {
      contentBlocks.push({
        type: 'text',
        text: currentPrompt.trim(),
      });
    }

    // Use the global working directory (always available after app startup)
    setIsSubmitting(true);
    try {
      const sessionTitle = currentPrompt.slice(0, 50) + (currentPrompt.length > 50 ? '...' : '');
      await startSession(sessionTitle, contentBlocks, workingDir || undefined);
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      clearAll();
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

  const careerCategories = [
    {
      id: 'plan',
      label: t('career.plan'),
      icon: Target,
      suggestions: [
        { text: t('career.plan90day'), prompt: 'Help me create a focused 90-day career development plan based on my current skills and goals.' },
        { text: t('career.reviewGoals'), prompt: 'Review my current career goals and provide feedback on my progress.' },
        { text: t('career.weekFocus'), prompt: 'Based on my goals and current tasks, what should I prioritize this week?' },
      ],
    },
    {
      id: 'learn',
      label: t('career.learn'),
      icon: GraduationCap,
      suggestions: [
        { text: t('career.skillGap'), prompt: 'Analyze my skill gaps for my target role and recommend learning resources.' },
        { text: t('career.findCourses'), prompt: 'Recommend courses and learning resources aligned with my career goals.' },
        { text: t('career.trendingSkills'), prompt: 'What skills are currently in high demand for my industry?' },
      ],
    },
    {
      id: 'jobs',
      label: t('career.jobs'),
      icon: Briefcase,
      suggestions: [
        { text: t('career.findJobs'), prompt: 'Search for job opportunities that match my skills, experience, and career goals.' },
        { text: t('career.resumeReview'), prompt: 'Review my resume and provide specific improvement suggestions for ATS optimization.' },
        { text: t('career.interviewPrep'), prompt: 'Help me prepare for interviews for my target role with practice questions.' },
      ],
    },
    {
      id: 'reflect',
      label: t('career.reflect'),
      icon: MessageSquare,
      suggestions: [
        { text: t('career.weeklyReflection'), prompt: 'Help me do a weekly review of my progress, wins, and areas to improve.' },
        { text: t('career.processThoughts'), prompt: 'I need to process some thoughts about my work situation. Help me gain clarity.' },
        { text: t('career.celebrateWins'), prompt: 'Help me recognize and celebrate my recent accomplishments.' },
      ],
    },
  ];

  const quickTags = [
    { id: 'create', label: t('welcome.createFile'), icon: FileText, prompt: 'Create a new file for me' },
    { id: 'crunch', label: t('welcome.crunchData'), icon: BarChart3, prompt: 'Help me analyze and process data' },
    { id: 'organize', label: t('welcome.organizeFiles'), icon: FolderOpen, prompt: 'Help me organize my files and folders' },
    { 
      id: 'email', 
      label: t('welcome.checkEmails'), 
      icon: Mail, 
      prompt: 'Help me use Chrome to summarize the new emails from the past three days in my Gmail and NetEase Mail. Note that the saved accounts already include the full email suffix. Therefore, if the email suffix is already pre-filled on the webpage or in a screenshot, do not enter it again, to avoid login failure. Also, first check whether the corresponding account credentials are saved. If the username or password for a given email service is not saved, you can skip that email account.',
      requiresChrome: true 
    },
    { 
      id: 'papers', 
      label: t('welcome.searchPapers'), 
      icon: BookOpen, 
      prompt: 'Please help me use Chrome to search for and summarize papers related to [Agent] within two days.\nSource websites:\n1. HuggingFace Daily Papers. Please include the vote information and a brief summary. Note that it may not include papers in the weekend, so you may need to check the papers in previous days. But make sure that there is a total of two days.',
      requiresChrome: true 
    },
    { 
      id: 'research-notion', 
      label: t('welcome.summarizePapersToNotion'), 
      icon: FileSearch, 
      prompt: 'Help me research three representative survey papers related to agents, and add them under a Notion page titled "Agent Survey". For each paper, include the title, authors, publication venue/year, and a brief summary of the main contributions.',
      requiresNotion: true 
    },
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8 animate-fade-in relative z-10">

        {/* Hero Heading */}
        <div className="flex flex-col items-center justify-center text-center space-y-3">
          <img
            src={CoeadaptLogo}
            alt="Coeadapt"
            className="h-10 w-auto object-contain drop-shadow-sm transition-transform hover:scale-105 duration-300 dark:brightness-0 dark:invert"
          />
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight">
            {t('welcome.title')}
          </h1>
        </div>

        {/* Main Input — Pill Shape */}
        <form
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`space-y-3 transition-all duration-300 ${
            isDragging ? 'ring-2 ring-accent rounded-2xl' : ''
          }`}
        >
          {/* Image previews */}
          {pastedImages.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4">
              {pastedImages.map((img, index) => (
                <div key={index} className="relative group">
                  <img
                    src={img.url}
                    alt={`Pasted ${index + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* File attachments */}
          {attachedFiles.length > 0 && (
            <div className="space-y-2 px-4">
              {attachedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{file.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="w-6 h-6 rounded-full bg-error/10 hover:bg-error/20 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pill Input Container */}
          <div
            className="flex items-end gap-2 p-2 rounded-full bg-surface/70 backdrop-blur-md border transition-all duration-300"
            style={{ borderColor: 'var(--color-card-border)' }}
          >
            {/* Folder + Attach buttons */}
            <button
              type="button"
              onClick={handleSelectFolder}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                workingDir
                  ? 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                  : 'text-accent hover:bg-accent-muted'
              }`}
              title={workingDir || t('welcome.selectWorkingFolder')}
            >
              <FolderOpen className="w-4 h-4" />
            </button>

            {isElectron && (
              <button
                type="button"
                onClick={handleFileSelect}
                className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('welcome.attachFiles')}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                adjustTextareaHeight();
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={t('chat.typeMessage')}
              rows={1}
              style={{ minHeight: '40px', maxHeight: '200px' }}
              className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm py-2 overflow-hidden"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                    return;
                  }
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Send button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-9 h-9 rounded-full flex items-center justify-center bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-all duration-300"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Workspace indicator */}
          {workingDir && (
            <p className="text-xs text-text-muted text-center">
              {workingDir.split(/[/\\]/).pop()}
            </p>
          )}
        </form>

        {/* Quick Action Tags — below input */}
        <div className="flex flex-wrap gap-2 justify-center">
          {quickTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag.id, tag.prompt)}
              className={`tag text-xs ${selectedTag === tag.id ? 'tag-active' : ''} ${
                ('requiresChrome' in tag && tag.requiresChrome) || ('requiresNotion' in tag && tag.requiresNotion) ? 'relative' : ''
              }`}
            >
              <tag.icon className={`w-3.5 h-3.5 ${selectedTag === tag.id ? 'text-accent' : 'text-text-muted'}`} />
              <span>{tag.label}</span>
              {'requiresChrome' in tag && tag.requiresChrome && (
                <span className="flex items-center gap-1 ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-accent/10 text-accent border border-accent/20">
                  <Chrome className="w-3 h-3" />
                </span>
              )}
              {'requiresNotion' in tag && tag.requiresNotion && (
                <span className="flex items-center gap-1 ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-surface-muted text-text-muted border border-border">
                  <span className="text-xs">N</span>
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Career Category Pills — compact row below */}
        <div className="flex items-center justify-center gap-2">
          {careerCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCareerCategory(activeCareerCategory === cat.id ? null : cat.id)}
              className={`tag text-xs py-1.5 px-3 ${activeCareerCategory === cat.id ? 'tag-active' : ''}`}
            >
              <cat.icon className={`w-3.5 h-3.5 ${activeCareerCategory === cat.id ? 'text-accent' : 'text-text-muted'}`} />
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Career Suggestions Grid */}
        {activeCareerCategory && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 animate-fade-in">
            {careerCategories
              .find((c) => c.id === activeCareerCategory)
              ?.suggestions.map((suggestion) => (
                <button
                  key={suggestion.text}
                  onClick={() => {
                    setActiveCareerCategory(null);
                    handleTagClick(suggestion.text, suggestion.prompt);
                  }}
                  className="tag text-left text-xs justify-between"
                >
                  <span className="flex-1">{suggestion.text}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
