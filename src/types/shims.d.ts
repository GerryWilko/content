declare module '#content/manifest' {
  export default Record<string, unknown>
  export const checksums: Record<string, string>
  export const tables: Record<string, string>
}

declare module '#content/components' {
  export const globalComponents: string[]
  export const localComponents: string[]
}

declare module '#content/dump' {
  export const dump: string
}

declare module '#content/collections' {
  export const collections: Record<string, unknown>
}
