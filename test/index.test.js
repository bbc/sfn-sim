import { vi, test, expect } from 'vitest';
import { load } from '../src/index';
import definition from './definition2.json';

const mockMyFunction = vi.fn((input) => `lambda result: ${input}`);

const resources = [
  {
    service: 'lambda',
    name: 'my-function',
    function: mockMyFunction,
  },
  {
    service: 's3',
    name: 'my-bucket',
    objects: [
      {
        key: 'my-object',
        body: 'my-object-body',
      },
    ],
  },
];

const options = {
  simulateWait: false,
};

test('run', async () => {
  const sfn = load(definition, resources, options);

  const result = await sfn.execute({ a: { value: 'input A' }, b: { value: 'input B' } });

  expect(result).toEqual([{ value: 'input A' }, { value: 'input B' }]);

  // expect(mockMyFunction).toHaveBeenCalled();
});
