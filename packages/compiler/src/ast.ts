export type FieldType =
  | 'string'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'float'
  | 'double'
  | 'bool'
  | 'bytes'
  | string; // Named custom message type

export interface FieldDefinition {
  name: string;
  type: FieldType;
  tag: number;
}

export interface MessageDefinition {
  name: string;
  fields: FieldDefinition[];
}

export interface MethodDefinition {
  name: string;
  inputType: string;
  outputType: string;
  isInputStream: boolean;
  isOutputStream: boolean;
}

export interface ServiceDefinition {
  name: string;
  methods: MethodDefinition[];
}

export interface SchemaAST {
  packageName: string;
  services: ServiceDefinition[];
  messages: MessageDefinition[];
}
