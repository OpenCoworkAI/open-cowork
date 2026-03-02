import { useState } from 'react';

export type PastedImage = {
  url: string;
  base64: string;
  mediaType: string;
};

export type AttachedFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resizeImageIfNeeded(blob: Blob): Promise<Blob> {
  // Claude API limit is 5MB for base64 encoded images
  // Base64 encoding increases size by ~33%, so we target 3.75MB for the blob
  const MAX_BLOB_SIZE = 3.75 * 1024 * 1024;

  if (blob.size <= MAX_BLOB_SIZE) {
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      const scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);
      const quality = 0.9;

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
}

async function processImageFiles(files: File[]): Promise<PastedImage[]> {
  const images: PastedImage[] = [];
  for (const file of files) {
    try {
      const resizedBlob = await resizeImageIfNeeded(file);
      const base64 = await blobToBase64(resizedBlob);
      const url = URL.createObjectURL(resizedBlob);
      images.push({ url, base64, mediaType: resizedBlob.type });
    } catch (err) {
      console.error('Failed to process image:', err);
    }
  }
  return images;
}

export function useFileAttachments(isElectron: boolean) {
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    const blobs = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
    const newImages = await processImageFiles(blobs);
    setPastedImages(prev => [...prev, ...newImages]);
  };

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

    if (imageFiles.length > 0) {
      const newImages = await processImageFiles(imageFiles);
      setPastedImages(prev => [...prev, ...newImages]);
    }

    if (otherFiles.length > 0) {
      const newFiles = await Promise.all(
        otherFiles.map(async (file) => {
          const droppedPath = ('path' in file && typeof file.path === 'string') ? file.path : '';
          const inlineDataBase64 = droppedPath ? undefined : await blobToBase64(file);
          return {
            name: file.name,
            path: droppedPath,
            size: file.size,
            type: file.type || 'application/octet-stream',
            inlineDataBase64,
          };
        })
      );
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) return;

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      const newFiles = filePaths.map((filePath) => {
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
        return {
          name: fileName,
          path: filePath,
          size: 0,
          type: 'application/octet-stream',
        };
      });

      setAttachedFiles(prev => [...prev, ...newFiles]);
    } catch (error) {
      console.error('Error selecting files:', error);
    }
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

  const clearAll = () => {
    pastedImages.forEach(img => URL.revokeObjectURL(img.url));
    setPastedImages([]);
    setAttachedFiles([]);
  };

  return {
    pastedImages,
    attachedFiles,
    isDragging,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    removeImage,
    removeFile,
    clearAll,
  };
}
