// The Worker serves the app at a directory URL, so every URL follows its mount path.
export const appPath = (path: string) => new URL(path, new URL('.', location.href)).pathname;
