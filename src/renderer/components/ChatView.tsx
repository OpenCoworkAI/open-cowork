import { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { MessageCard } from './MessageCard';
import type { Message, ContentBlock } from '../types';
import {
  Send,
  Square,
  Plus,
  Loader2,
  Plug,
  X,
} from 'lucide-react';

export function ChatView() {
  const {
    activeSessionId,
    sessions,
    messagesBySession,
    partialMessagesBySession,
    activeTurnsBySession,
    pendingTurnsBySession,
    appConfig,
  } = useAppStore();
  const { continueSession, stopSession, isElectron } = useIPC();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<any[]>([]);
  const [pastedImages, setPastedImages] = useState<Array<{ url: string; base64: string; mediaType: string }>>([]);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; path: string; size: number; type: string }>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSessionId ? messagesBySession[activeSessionId] || [] : [];
  const pendingTurns = activeSessionId ? pendingTurnsBySession[activeSessionId] || [] : [];
  const partialMessage = activeSessionId ? partialMessagesBySession[activeSessionId] || '' : '';
  const activeTurn = activeSessionId ? activeTurnsBySession[activeSessionId] : null;
  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const canStop = hasActiveTurn || pendingCount > 0;

  const displayedMessages = useMemo(() => {
    if (!activeSessionId) return messages;
    if (!partialMessage || !activeTurn?.userMessageId) return messages;
    const anchorIndex = messages.findIndex((message) => message.id === activeTurn.userMessageId);
    if (anchorIndex === -1) return messages;

    let insertIndex = anchorIndex + 1;
    while (insertIndex < messages.length) {
      if (messages[insertIndex].role === 'user') break;
      insertIndex += 1;
    }

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}`,
      sessionId: activeSessionId,
      role: 'assistant',
      content: [{ type: 'text', text: partialMessage }],
      timestamp: Date.now(),
    };

    return [
      ...messages.slice(0, insertIndex),
      streamingMessage,
      ...messages.slice(insertIndex),
    ];
  }, [activeSessionId, activeTurn?.userMessageId, messages, partialMessage]);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;
    const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';

    if (!isStreamingTick) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;

      try {
        // Resize if needed to stay under API limit
        const resizedBlob = await resizeImageIfNeeded(blob);
        const base64 = await blobToBase64(resizedBlob);
        const url = URL.createObjectURL(resizedBlob);
        newImages.push({
          url,
          base64,
          mediaType: resizedBlob.type as any,
        });
      } catch (err) {
        console.error('Failed to process pasted image:', err);
      }
    }

    setPastedImages(prev => [...prev, ...newImages]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Resize and compress image if needed to stay under 5MB base64 limit
  const resizeImageIfNeeded = async (blob: Blob): Promise<Blob> => {
    // Claude API limit is 5MB for base64 encoded images
    // Base64 encoding increases size by ~33%, so we target 3.75MB for the blob
    const MAX_BLOB_SIZE = 3.75 * 1024 * 1024; // 3.75MB

    if (blob.size <= MAX_BLOB_SIZE) {
      return blob; // No need to resize
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate scaling factor to reduce file size
        // We use a more aggressive approach: scale down until size is acceptable
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Start with a scale factor based on size ratio
        let scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);
        let quality = 0.9;

        const attemptCompress = (currentScale: number, currentQuality: number): Promise<Blob> => {
          canvas.width = Math.floor(img.width * currentScale);
          canvas.height = Math.floor(img.height * currentScale);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          return new Promise((resolveBlob) => {
            canvas.toBlob(
              (compressedBlob) => {
                if (!compressedBlob) {
                  reject(new Error('Failed to compress image'));
                  return;
                }

                // If still too large, try again with lower quality or scale
                if (compressedBlob.size > MAX_BLOB_SIZE && (currentQuality > 0.5 || currentScale > 0.3)) {
                  const newQuality = Math.max(0.5, currentQuality - 0.1);
                  const newScale = currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                  attemptCompress(newScale, newQuality).then(resolveBlob);
                } else {
                  resolveBlob(compressedBlob);
                }
              },
              blob.type || 'image/jpeg',
              currentQuality
            );
          });
        };

        attemptCompress(scale, quality).then(resolve).catch(reject);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  };

  const removeImage = (index: number) => {
    setPastedImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[ChatView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      // Get file info for each selected file
      const newFiles = filePaths.map((filePath) => {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
        return {
          name: fileName,
          path: filePath,
          size: 0, // Will be set by backend when copying
          type: 'application/octet-stream',
        };
      });

      setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[ChatView] Error selecting files:', error);
    }
  };

  // Handle drag and drop for images
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const otherFiles = files.filter(file => !file.type.startsWith('image/'));

    // Process images
    if (imageFiles.length > 0) {
      const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

      for (const file of imageFiles) {
        try {
          // Resize if needed to stay under API limit
          const resizedBlob = await resizeImageIfNeeded(file);
          const base64 = await blobToBase64(resizedBlob);
          const url = URL.createObjectURL(resizedBlob);
          newImages.push({
            url,
            base64,
            mediaType: resizedBlob.type,
          });
        } catch (err) {
          console.error('Failed to process dropped image:', err);
        }
      }

      setPastedImages(prev => [...prev, ...newImages]);
    }

    // Process other files
    if (otherFiles.length > 0) {
      const newFiles = otherFiles.map(file => ({
        name: file.name,
        path: file.path || '', // Electron provides path property
        size: file.size,
        type: file.type || 'application/octet-stream',
      }));

      setAttachedFiles(prev => [...prev, ...newFiles]);
    }
  };

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await window.electronAPI.mcp.getServerStatus();
          const active = statuses?.filter((s: any) => s.connected && s.toolCount > 0) || [];
          setActiveConnectors(active);
        } catch (err) {
          console.error('Failed to load MCP connectors:', err);
        }
      };
      loadConnectors();
      // Refresh every 5 seconds
      const interval = setInterval(loadConnectors, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if ((!currentPrompt.trim() && pastedImages.length === 0 && attachedFiles.length === 0) || !activeSessionId || isSubmitting) return;

    setIsSubmitting(true);
    try {
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
          relativePath: file.path, // Will be processed by backend to copy to .tmp
          size: file.size,
          mimeType: file.type,
        });
      });

      // Add text if present
      if (currentPrompt.trim()) {
        contentBlocks.push({
          type: 'text',
          text: currentPrompt.trim(),
        });
      }

      // Send message with content blocks
      await continueSession(activeSessionId, contentBlocks);

      // Clean up
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      pastedImages.forEach(img => URL.revokeObjectURL(img.url));
      setPastedImages([]);
      setAttachedFiles([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = () => {
    if (activeSessionId) {
      stopSession(activeSessionId);
    }
  };

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>Loading conversation...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-6 bg-surface/80 backdrop-blur-sm">
        <div />
        <h2 className="font-medium text-text-primary text-center truncate max-w-lg">
          {activeSession.title}
        </h2>
        {activeConnectors.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 justify-self-end">
            <Plug className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs text-purple-500 font-medium">
              {activeConnectors.length} connector{activeConnectors.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
          {displayedMessages.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <p>Start the conversation</p>
            </div>
          ) : (
            displayedMessages.map((message) => {
              const isStreaming = typeof message.id === 'string' && message.id.startsWith('partial-');
              return (
                <div key={message.id}>
                  <MessageCard message={message} isStreaming={isStreaming} />
                </div>
              );
            })
          )}

          {/* Processing indicator */}
          {hasActiveTurn && !partialMessage && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-border max-w-fit">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              <span className="text-sm text-text-secondary">
                Processing...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface/80 backdrop-blur-sm">
        <div className="px-4 py-4">
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative w-full"
          >
            {/* Image previews */}
            {pastedImages.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mb-3">
                {pastedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img.url}
                      alt={`Pasted ${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg border border-border block"
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
              <div className="space-y-2 mb-3">
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

            <div
              className={`flex items-end gap-2 p-3 rounded-3xl bg-surface transition-colors ${
                isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
              }`}
              style={{ border: '1px solid rgba(255, 255, 255, 0.1)' }}
            >
              <button
                type="button"
                onClick={handleFileSelect}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title="Attach files"
              >
                <Plus className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  // Enter to send, Shift+Enter for new line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Reply..."
                disabled={isSubmitting}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm py-1.5"
              />

              <div className="flex items-center gap-2">
                {/* Model display */}
                <span className="px-2 py-1 text-xs text-text-muted">
                  {appConfig?.model || 'No model'}
                </span>

                {canStop && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={(!prompt.trim() && !textareaRef.current?.value.trim() && pastedImages.length === 0 && attachedFiles.length === 0) || isSubmitting}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-text-muted text-center mt-2">
              Open Cowork is AI-powered and may make mistakes. Please double-check responses.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
