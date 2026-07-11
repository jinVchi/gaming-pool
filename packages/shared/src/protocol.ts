export interface ClientMessage<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
}

export interface ServerMessage<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
}
