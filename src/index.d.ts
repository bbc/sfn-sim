export interface StateMachine {
  execute: (input: object) => Promise<object>;
}

export interface Options {
  executionName?: string;
  stateMachineName?: string;
  validateDefinition?: boolean;
  simulateWait?: boolean;
}

export interface Resource {
  service: string;
  name: string;
  taskCallback?: (taskInput: object, taskOutput: object) => Promise<object>;
}

export interface LambdaResource extends Resource {
  service: 'lambda';
  function: (input: object) => Promise<object>;
}

export interface S3Object {
  key: string;
  body: string;
}

export interface S3Resource extends Resource {
  service: 's3';
  objects: S3Object[];
}

export interface SNSResource extends Resource {
  service: 'sns';
  messages: string[];
}

export interface SQSResource extends Resource {
  service: 'sqs';
  messages: string[];
}

export interface StepFunctionsResource extends Resource {
  service: 'stepFunctions';
  stateMachine: (input: object) => Promise<object>;
}

export declare function load(definition: object, resources?: Resource[], overrideOptions?: Options): StateMachine;
