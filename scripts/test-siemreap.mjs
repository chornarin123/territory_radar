const query = `[out:json][timeout:30]; (
  node["amenity"~"cafe|restaurant|bank|hotel|pharmacy"](around:5000,13.3633,103.8564);
  node["shop"](around:5000,13.3633,103.8564);
); out center body 50;`.replace(/\s+/g, ' ').trim();

const endpoints = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function run() {
  for (const url of endpoints) {
    try {
      console.log(`Querying ${url}...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PPCB-Competition-Testing-Script/1.0',
        },
        body: new URLSearchParams({ data: query }),
      });
      const text = await res.text();
      if (!text.trim().startsWith('<')) {
        const json = JSON.parse(text);
        const named = (json.elements || []).filter(
          (e) => e.tags && (e.tags.name || e.tags['name:en'])
        );
        console.log(`Success! Total elements: ${json.elements.length}, Named: ${named.length}`);
        console.log('Sample places in Siem Reap:');
        named.slice(0, 10).forEach((p, idx) => {
          console.log(`  ${idx + 1}. ${p.tags.name || p.tags['name:en']} (${p.tags.amenity || p.tags.shop}) @ ${p.lat}, ${p.lon}`);
        });
        return;
      } else {
        console.log(`${url} returned HTML/XML error: ${text.slice(0, 80)}...`);
      }
    } catch (e) {
      console.log(`${url} error:`, e.message);
    }
  }
}

run();
