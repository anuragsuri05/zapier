import { createContext, useContext } from 'react';

/** Editor-wide data: flow, plan, connections, helpers. */
export const EditorCtx = createContext(null);
export const useEditor = () => useContext(EditorCtx);

/** Variables available to the currently edited step: {groups:[{key,label,app,data}], scopes:{key:data}} */
export const VarCtx = createContext({ groups: [], scopes: {} });
export const useVars = () => useContext(VarCtx);
