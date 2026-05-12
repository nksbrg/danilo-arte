exports.handler = async function (event) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_DB    = process.env.NOTION_DATABASE_ID;

  if (!NOTION_TOKEN || !NOTION_DB) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Variabili d'ambiente mancanti" }),
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

    const data = await response.json();

    // Trasforma i risultati Notion in formato semplice per il sito
    const opere = data.results.map((page) => {
      const props = page.properties;
      return {
        id: page.id,
        titolo: props.Titolo?.title?.[0]?.plain_text || "Senza titolo",
        anno:   props.Anno?.number || null,
        tecnica: props.Tecnica?.rich_text?.[0]?.plain_text || "",
        immagine: props.Immagine?.files?.[0]?.file?.url ||
                  props.Immagine?.files?.[0]?.external?.url || null,
      };
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(opere),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

