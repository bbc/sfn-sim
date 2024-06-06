# sfn-sim - Step Function simulator

This library simulates the AWS Step Function runtime to unit test state machines, a lightweight
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

Note that CloudFormation functions and refs are not supported; you should replace these in your
definition before loading it.


## `resources`

This should be an array of objects which are AWS resources used by any `Task` steps in your state
machine. Each object must contain `service` and `name` fields, and additional fields depending on
the service.

The supported `service` values are `lambda` and `s3`. See below for details and an example test.


### `lambda`

This resource should contain a `function` field which must be a function. This will be executed as
your lambda handler.


### `s3`

This resource should contain an `objects` field which must be an array. This can optionally be
pre-populated with objects, which must contain `key` and `body` fields.


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


## Notes

This library is currently a work-in-progress and does not support every feature of Step Functions.
Some functionality yet to be implemented:

* `Retry` and `Catch` fields
* Most AWS resources in `Task` steps
* Most intrinstic functions
* Some data-test expressions in `Choice` steps
* Some runtime error handling and data validation

`Map` steps are not currently supported by the validation library, so definitions containing these
steps will need `validateDefinition` set to `false`.