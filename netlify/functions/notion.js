exports.handler = async function (event) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_DB    = process.env.NOTION_DATABASE_ID;

  // Solo GET e POST permessi
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!NOTION_TOKEN || !NOTION_DB) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Configurazione mancante" }),
    };
  }

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DB}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            property: "Pubblicato",
            checkbox: { equals: true },
          },
          sorts: [{ property: "Ordine", direction: "ascending" }],
        }),
      }
    );

    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Errore comunicazione con Notion" }),
      };
    }

    const data = await response.json();

    if (!data.results) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Risposta Notion non valida" }),
      };
    }

    function notionRichText(prop) {
      if (!prop?.rich_text?.length) return "";
      return prop.rich_text.map((b) => b.plain_text).join("");
    }

    const opere = data.results.map((page) => {
      const props = page.properties;
      const immagine = props.Immagine?.url ||
                       props.Immagine?.files?.[0]?.file?.url ||
                       props.Immagine?.files?.[0]?.external?.url || null;

      // Valida che il link immagine sia un URL Cloudinary o HTTPS valido
      const immagineValidata = immagine && immagine.startsWith("https://") ? immagine : null;

      return {
        id: page.id,
        titolo: props.Titolo?.title?.[0]?.plain_text || "Senza titolo",
        anno:   props.Anno?.number || null,
        tecnica: notionRichText(props.Tecnica),
        dimensioni: notionRichText(props.Dimensioni),
        descrizione: notionRichText(props.Descrizione),
        immagine: immagineValidata,
      };
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60", // cache 60 secondi
      },
      body: JSON.stringify(opere),
    };
  } catch (err) {
    // Non esporre dettagli dell'errore al client
    console.error("Notion function error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno del server" }),
    };
  }
};
