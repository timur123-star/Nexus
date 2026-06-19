// Vite `?worker` imports for Monaco's web workers (self-hosted, offline-safe).
declare module "monaco-editor/esm/vs/editor/editor.worker?worker" {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
declare module "monaco-editor/esm/vs/language/json/json.worker?worker" {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
