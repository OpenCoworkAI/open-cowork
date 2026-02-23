/**
 * OpenClaw Co-Working Environment
 *
 * The environment is OpenClaw's workspace — a structured filesystem where
 * the agent and user collaborate on career artifacts. Unlike a chatbot
 * that forgets everything, OpenClaw maintains a persistent workspace
 * with documents, drafts, research, and portfolio pieces.
 *
 * When running standalone, this is OpenClaw's own sandbox.
 * When embedded in Coeadapt, it integrates with the platform's sandbox system.
 */

import type {
  CoWorkEnvironment,
  WorkspaceSection,
  Artifact,
  ArtifactType,
} from '../types';

const DEFAULT_SECTIONS: Omit<WorkspaceSection, 'path'>[] = [
  { id: 'documents', name: 'Documents',  type: 'documents' },
  { id: 'drafts',    name: 'Drafts',     type: 'drafts' },
  { id: 'portfolio', name: 'Portfolio',   type: 'portfolio' },
  { id: 'research',  name: 'Research',    type: 'research' },
  { id: 'scratch',   name: 'Scratch',     type: 'scratch' },
];

export class OpenClawEnvironment {
  private workspacePath: string;
  private sections: WorkspaceSection[] = [];
  private artifacts: Map<string, Artifact> = new Map();

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Initialize the workspace directory structure.
   * Creates section directories if they don't exist.
   */
  async initialize(): Promise<CoWorkEnvironment> {
    this.sections = DEFAULT_SECTIONS.map(section => ({
      ...section,
      path: `${this.workspacePath}/${section.id}`,
    }));

    // In a real implementation, create directories via the sandbox adapter
    // For now, return the environment descriptor
    return this.describe();
  }

  /**
   * Describe the current state of the environment.
   */
  describe(): CoWorkEnvironment {
    return {
      workspacePath: this.workspacePath,
      sections: [...this.sections],
      artifacts: Array.from(this.artifacts.values()),
    };
  }

  /**
   * Register a new artifact in the workspace.
   * Called when OpenClaw generates a document, plan, or other work product.
   */
  registerArtifact(
    name: string,
    type: ArtifactType,
    sectionId: string,
    metadata?: Record<string, unknown>,
  ): Artifact {
    const section = this.sections.find(s => s.id === sectionId);
    if (!section) {
      throw new Error(`Unknown workspace section: ${sectionId}`);
    }

    const artifact: Artifact = {
      id: crypto.randomUUID(),
      name,
      type,
      path: `${section.path}/${name}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata,
    };

    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  /**
   * Update an existing artifact's metadata or timestamp.
   */
  updateArtifact(artifactId: string, updates: Partial<Pick<Artifact, 'name' | 'metadata'>>): Artifact {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (updates.name) artifact.name = updates.name;
    if (updates.metadata) artifact.metadata = { ...artifact.metadata, ...updates.metadata };
    artifact.updatedAt = Date.now();

    return artifact;
  }

  /**
   * List artifacts, optionally filtered by type or section.
   */
  listArtifacts(filter?: { type?: ArtifactType; sectionId?: string }): Artifact[] {
    let results = Array.from(this.artifacts.values());

    if (filter?.type) {
      results = results.filter(a => a.type === filter.type);
    }

    if (filter?.sectionId) {
      const section = this.sections.find(s => s.id === filter.sectionId);
      if (section) {
        results = results.filter(a => a.path.startsWith(section.path));
      }
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get the path for a specific workspace section.
   */
  getSectionPath(sectionId: string): string {
    const section = this.sections.find(s => s.id === sectionId);
    if (!section) {
      throw new Error(`Unknown workspace section: ${sectionId}`);
    }
    return section.path;
  }

  /**
   * Remove an artifact from the registry.
   */
  removeArtifact(artifactId: string): void {
    this.artifacts.delete(artifactId);
  }
}

export default OpenClawEnvironment;
