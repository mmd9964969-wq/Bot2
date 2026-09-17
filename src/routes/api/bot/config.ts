import { json } from "@tanstack/react-start";

export async function GET() {
  return json({
    ok: true,
    message: "Bot config API is working",
  });
}
