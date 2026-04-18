// Minimal test: does an Effect fiber make progress while Ink is rendering?
import { render, Text, Box } from "ink";
import { Effect, Ref } from "effect";
import React, { useState, useEffect } from "react";

const counterRef = await Effect.runPromise(Ref.make(0));

// Fiber that increments a counter every second
const fiber = Effect.runPromise(
  Effect.gen(function* () {
    console.error("DRIVER: started");
    for (let i = 1; i <= 5; i++) {
      yield* Effect.sleep("1 second");
      yield* Ref.set(counterRef, i);
      console.error(`DRIVER: set counter to ${i}`);
    }
    console.error("DRIVER: done");
  })
);

const App = () => {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    const id = setInterval(async () => {
      const v = await Effect.runPromise(Ref.get(counterRef));
      setCount(v);
    }, 200);
    return () => clearInterval(id);
  }, []);
  
  return React.createElement(Box, null, React.createElement(Text, null, `Counter: ${count}`));
};

console.error("Starting Ink render...");
const { waitUntilExit } = render(
  React.createElement(App),
  { exitOnCtrlC: true, stdin: process.stdin, stdout: process.stdout }
);

setTimeout(() => process.exit(0), 8000);
await fiber;
