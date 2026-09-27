export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface SymbolInformation {
  name: string;
  kind: SymbolKind;
  location: Location;
  containerName?: string;
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface Hover {
  contents:
    | string
    | { language?: string; value: string }
    | Array<string | { language?: string; value: string }>;
  range?: Range;
}

export interface CallHierarchyItem {
  name: string;
  kind: SymbolKind;
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
  data?: unknown;
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  fromRanges: Range[];
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}

export interface TypeHierarchyItem {
  name: string;
  kind: SymbolKind;
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export function symbolKindToString(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.Class:
      return "class";
    case SymbolKind.Method:
      return "method";
    case SymbolKind.Function:
      return "function";
    case SymbolKind.Struct:
      return "struct";
    case SymbolKind.Variable:
      return "variable";
    case SymbolKind.Field:
      return "field";
    case SymbolKind.Constructor:
      return "constructor";
    case SymbolKind.Enum:
      return "enum";
    case SymbolKind.EnumMember:
      return "enum_member";
    case SymbolKind.Namespace:
      return "namespace";
    case SymbolKind.Interface:
      return "interface";
    case SymbolKind.Constant:
      return "constant";
    case SymbolKind.Module:
      return "module";
    default:
      return "symbol";
  }
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: number | string;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export function diagnosticSeverityToString(
  severity?: DiagnosticSeverity,
): "error" | "warning" | "information" | "hint" {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
      return "information";
    case DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "error";
  }
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface TextDocumentEdit {
  textDocument: {
    uri: string;
    version?: number | null;
  };
  edits: TextEdit[];
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: TextDocumentEdit[];
}

export interface RenameParams {
  textDocument: { uri: string };
  position: Position;
  newName: string;
}
