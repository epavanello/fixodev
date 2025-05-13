// Sample TypeScript file for testing
interface TestInterface {
  id: number;
  name: string;
}

class TestClass {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  setValue(newValue: string): void {
    this.value = newValue;
  }
}

function testFunction(param: string): string {
  return `Test: ${param}`;
}

export { TestInterface, TestClass, testFunction };
