export function createStandaloneReaderResponse(
  widgetHtml: string,
  standaloneState: Record<string, unknown>
): Response {
  const bridge = `<script>window.openai={toolOutput:${JSON.stringify(standaloneState)},callTool:async()=>({unavailable:true,reason:"no-host"}),sendFollowUpMessage:async()=>{alert("这条消息需要回到 ChatGPT 对话里发送。")}};</script>`;
  return new Response(widgetHtml.replace("</head>", `${bridge}</head>`), {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive"
    }
  });
}
