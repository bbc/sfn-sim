class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class SimulatorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SimulatorError';
  }
}

class RuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimeError';
  }
}

class FailError extends RuntimeError {
  constructor(error = 'Failed', cause = 'State machine failed') {
    super(cause);
    this.name = error;
  }
}

class TimeoutError extends RuntimeError {
  constructor() {
    super('A Task State either ran longer than the "TimeoutSeconds" value, or failed to heartbeat for a time longer than the "HeartbeatSeconds" value.');
    this.name = 'States.Timeout';
  }
}

class TaskFailedError extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = 'States.TaskFailed';
  }
}

class ResultPathMatchFailureError extends RuntimeError {
  constructor() {
    super('A state’s "ResultPath" field cannot be applied to the input the state received.');
    this.name = 'States.ResultPathMatchFailure';
  }
}

class ParameterPathFailureError extends RuntimeError {
  constructor() {
    super('Within a state’s "Parameters" field, the attempt to replace a field whose name ends in ".$" using a Path failed.');
    this.name = 'States.ParameterPathFailure';
  }
}

class BranchFailedError extends RuntimeError {
  constructor() {
    super('A branch of a Parallel State failed.');
    this.name = 'States.BranchFailed';
  }
}

class NoChoiceMatchedError extends RuntimeError {
  constructor() {
    super('A Choice State failed to find a match for the condition field extracted from its input.');
    this.name = 'States.NoChoiceMatched';
  }
}

class IntrinsicFailureError extends RuntimeError {
  constructor(error) {
    super(`Within a Payload Template, the attempt to invoke an Intrinsic Function failed.\n${error}`);
    this.name = 'States.IntrinsicFailure';
  }
}

class ExceedToleratedFailureThresholdError extends RuntimeError {
  constructor() {
    super('A Map state failed because the number of failed items exceeded the configured tolerated failure threshold.');
    this.name = 'States.ExceedToleratedFailureThreshold';
  }
}

class ItemReaderFailedError extends RuntimeError {
  constructor() {
    super('A Map state failed to read all items as specified by the "ItemReader" field.');
    this.name = 'States.ItemReaderFailed';
  }
}

class ResultWriterFailedError extends RuntimeError {
  constructor() {
    super('A Map state failed to write all results as specified by the "ResultWriter" field.');
    this.name = 'States.ResultWriterFailed';
  }
}

export {
  ValidationError,
  SimulatorError,
  RuntimeError,
  FailError,
  TaskFailedError,
  NoChoiceMatchedError,
  IntrinsicFailureError,
};
