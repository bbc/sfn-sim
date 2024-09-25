# sfn-sim: Step Function simulator

This library simulates the AWS Step Functions runtime to unit test state machines, a lightweight
alternative to integration testing with LocalStack.


## Installation

```sh
npm install --save-dev sfn-sim
```


## Usage

Import the `load` function, load your state machine, then execute with some input:

```js
import { load } from 'sfn-sim';

const stateMachine = load(definition, resources, options);

await stateMachine.execute(input);
```

See below for details on these parameters.


## `definition`

This must be a JSON object which is the `Definition` property of a state machine, which contains the
`StartAt` and `States` fields at its root.

By default, your definition will be validated using [statelint](https://github.com/wmfs/statelint);
this can be disabled with the `validateDefinition` option set to `false`.

Note that CloudFormation functions and refs are not supported; you should replace these in your
definition before loading it.


## `resources`

This should be an array of objects which are AWS resources used by any `Task` steps in your state
machine. Each object must contain `service` and `name` fields, and additional fields depending on
the service.

The supported `service` values are listed below with their requirements, as well as an example using
the Lambda and S3 services.


### `lambda`

This resource must contain a `function` field which must be a function. This will be executed as
your lambda handler.


### `s3`

This resource must contain an `objects` field which must be an array. This can optionally be
pre-populated with objects, which must contain `key` and `body` fields.


### `sns`

This resource must contain a `messages` field which must be an array.


### `sqs`

This resource must contain a `messages` field which must be an array.


### `stepFunctions`

This resource must contain a `stateMachine` field which must be a function. This will be executed as
your state machine.


### Resources example

```js
const definition = {
  StartAt: 'CalculateSquare',
  States: {
    CalculateSquare: {
      Type: 'Task',
      Resource: 'arn:aws:lambda:::function:calculate-square',
      InputPath: '$.value',
      ResultPath: '$.value',
      Next: 'SaveToS3',
    },
    SaveToS3: {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
      Parameters: {
        Bucket: 'squared-numbers',
        'Key.$': '$.number',
        'Body.$': '$.value',
      },
      End: true,
    },
  },
};

const bucketObjects = [];
const resources = [
  {
    service: 'lambda',
    name: 'calculate-square',
    function: (x) => x * x,
  },
  {
    service: 's3',
    name: 'squared-numbers',
    objects: bucketObjects,
  },
];

const stateMachine = load(definition, resources);

test('writes a squared number to S3', async () => {
  await stateMachine.execute({
    number: 'three',
    value: 3,
  });

  expect(bucketObjects).toContainEqual({
    key: 'three',
    body: 9,
  });
});
```


## `options`

This should be an object which can be used to override the default configuration of the simulator.

| Key | Description | Default |
| --- | ----------- | ------- |
| `validateDefinition` | Whether the provided definition should be validated on `load` | `true` |
| `simulateWait` | Whether any `Wait` steps should wait in real-time, otherwise passing immediately | `false` |
| `stateMachineName` | Identifier for the state machine, passed to the context object | `undefined` |
| `executionName` | Identifier for the execution, passed to the context object | `undefined` |


## Notes

This library supports most available features of Step Functions. Some functionality has not been
implemented yet, including:

* Some AWS resources in `Task` steps
* Some runtime error handling and data validation
