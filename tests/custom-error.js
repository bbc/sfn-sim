class MockCustomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MockCustomError';
  }
}

export default MockCustomError;