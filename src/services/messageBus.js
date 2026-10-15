import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notifyNewMessage(recipientId) {
  bus.emit(`message:${recipientId}`);
}

// Espera un mensaje nuevo para el socio o el tiempo indicado, lo que ocurra primero.
export function waitForNewMessage(recipientId, timeoutMs) {
  return new Promise((resolve) => {
    const event = `message:${recipientId}`;
    const done = () => {
      clearTimeout(timer);
      bus.off(event, done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, timeoutMs));
    bus.on(event, done);
  });
}
