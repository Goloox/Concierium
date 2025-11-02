import Busboy from "busboy";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const contentType = event.headers["content-type"] || event.headers["Content-Type"];
  if (!contentType || !contentType.startsWith("multipart/form-data")) {
    return { statusCode: 400, body: "Expected multipart/form-data" };
  }

  const busboy = Busboy({ headers: { "content-type": contentType } });

  const files = [];
  const fields = {};

  return new Promise((resolve) => {
    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        const buffer = Buffer.concat(chunks);
        files.push({ name, filename: info.filename, mime: info.mimeType, size: buffer.length });
        // Aquí podrías subir a S3/Blob/etc.
      });
    });

    busboy.on("field", (name, value) => { fields[name] = value; });

    busboy.on("finish", () => {
      resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, fields, files })
      });
    });

    busboy.end(Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8"));
  });
}
