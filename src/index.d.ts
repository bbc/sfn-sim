export interface StateMachine {
  execute: (input: object) => object;
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
}

export interface LambdaResource implements Resource {
  service: 'lambda';
  function: (input: object) => object;
}

export interface S3Object {
  key: string;
  body: string;
}

export interface S3Resource implements Resource {
  service: 's3';
  objects: S3Object[];
}

export interface SNSResource implements Resource {
  service: 'sns';
  messages: string[];
}

export interface SQSResource implements Resource {
  service: 'sqs';
  messages: string[];
}

export interface StepFunctionsResource implements Resource {
  service: 'stepFunctions';
  stateMachine: (input: object) => object;
}

export declare function load(definition: object, resources?: Resource[], overrideOptions?: Options): StateMachine;
