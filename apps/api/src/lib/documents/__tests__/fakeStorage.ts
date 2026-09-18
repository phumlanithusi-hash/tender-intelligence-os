import type { DocumentStorage } from '../storage.js'

/** In-memory `DocumentStorage` for unit/integration tests — no live Supabase project exists in this sandbox (Phase 6 binding constraint). */
export function createFakeStorage(): DocumentStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async upload(path, bytes) {
      files.set(path, bytes)
    },
    async download(path) {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`fake storage: no file at ${path}`)
      return bytes
    },
    async createSignedUrl(path) {
      return files.has(path) ? `https://fake-storage.local/signed/${encodeURIComponent(path)}` : null
    },
  }
}
