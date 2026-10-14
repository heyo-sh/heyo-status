import { statusHandler } from "@heyo-sh/heyo-status/next";

import { requestStatusPage } from "../../../../heyo-status.config";

async function handler() {
  return statusHandler(await requestStatusPage());
}

export async function GET(request: Request) {
  return (await handler()).GET(request);
}
export async function POST(request: Request) {
  return (await handler()).POST(request);
}
export async function PATCH(request: Request) {
  return (await handler()).PATCH(request);
}
export async function PUT(request: Request) {
  return (await handler()).PUT(request);
}
export async function DELETE(request: Request) {
  return (await handler()).DELETE(request);
}
