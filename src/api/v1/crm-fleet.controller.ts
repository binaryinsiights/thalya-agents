import { Elysia, t } from "elysia";
import { doc, errorResponse, jsonResponse } from "@/api/lib/openapi";
import { receiveCrmHeartbeat } from "@/modules/crm/heartbeat";

export const crmFleetController = new Elysia({
  prefix: "/v1/crm/fleet",
  tags: ["CRM"],
}).post(
  "/heartbeat/:deploymentKey",
  async ({ params, request }) => {
    const rawBody = await request.text();
    return receiveCrmHeartbeat({
      deploymentKey: params.deploymentKey,
      rawBody,
      signature: request.headers.get("x-secretaria-signature"),
      timestamp: request.headers.get("x-secretaria-timestamp"),
    });
  },
  {
    params: t.Object({
      deploymentKey: t.String({ minLength: 8, maxLength: 200 }),
    }),
    detail: {
      ...doc(
        "Fleet heartbeat",
        "Recebe estado sanitizado e assinado de uma instalação gerenciada.",
      ),
      security: [],
      responses: {
        200: jsonResponse(
          "Heartbeat aceito ou duplicado.",
          t.Object({
            outcome: t.Union([t.Literal("accepted"), t.Literal("duplicate")]),
          }),
        ),
        400: errorResponse(400),
        401: errorResponse(401),
        429: errorResponse(429),
      },
    },
  },
);
