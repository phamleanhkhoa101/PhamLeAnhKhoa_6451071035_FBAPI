import { Kafka } from "kafkajs";
import dotenv from "dotenv";

dotenv.config();

export const kafka = new Kafka({
  clientId: "backend-api",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"]
});

export async function createProducer() {
  const producer = kafka.producer();
  await producer.connect();
  return producer;
}

export async function createConsumer(groupId) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
}

export async function publishMessage(producer, topic, message) {
  await producer.send({
    topic,
    messages: [
      {
        key: message.command_id || message.event_id || Date.now().toString(),
        value: JSON.stringify(message)
      }
    ]
  });
}