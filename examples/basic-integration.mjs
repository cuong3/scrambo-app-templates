import { ScramboClient, StatefulSession } from "../shared/client.js";

const [videoPath, mimeType = "video/mp4"] = process.argv.slice(2);

if (!videoPath) {
  console.error("Usage: pnpm quickstart /path/to/video.mp4 [mime-type]");
  process.exitCode = 1;
} else {
  const client = ScramboClient.fromEnv();
  const created = await client.createSession({
    project: `quickstart-${Date.now()}`,
  });
  const session = new StatefulSession(client, created);
  const progress = {
    onEvent: (event) => console.log(event.message),
  };

  try {
    const asset = await session.uploadFile(videoPath, mimeType);
    console.log(`Uploaded ${asset.name} as ${asset.assetId}`);

    await session.edit({
      agent: "source.work",
      message: "Transcribe the footage and identify its strongest story beats.",
      tools: ["transcribe"],
    }, progress);

    const edit = await session.edit({
      agent: "timeline.author",
      message: "Create a concise edit using the strongest story beats.",
    }, progress);

    console.log(JSON.stringify({
      sessionId: session.sessionId,
      editId: edit.editId,
    }, null, 2));
  } finally {
    await session.close();
  }
}
