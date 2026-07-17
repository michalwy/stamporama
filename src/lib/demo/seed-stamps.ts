import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import type { DemoCatalog } from "./seed-catalog";
import type { DemoAreas } from "./seed-areas";

interface CompactIssue {
  a: string;
  n: string;
  y: number;
  fi?: number;
  mi?: number;
  fiPfx?: string;
  s: string[];
  opt?: number[];
  v?: Record<number, string[]>;
}

function buildIssues(): CompactIssue[] {
  return [
    // ═══ Poland > Second Republic > Definitives & Overprints ═══

    { a: "sr-def", n: "Eagle Definitives I", y: 1918, fi: 1, mi: 1, s: [
      "3hal gray", "5hal green", "10hal magenta", "15hal violet", "20hal olive",
      "25hal dark blue", "40hal brown", "50hal orange", "1kr carmine", "2kr dark blue",
    ] },
    { a: "sr-def", n: "Eagle Definitives II", y: 1919, fi: 56, mi: 56, s: [
      "5f green", "6f violet", "10f red", "15f gray", "20f olive",
      "25f blue", "40f magenta", "50f brown",
    ] },
    { a: "sr-def", n: "Eagle Definitives III", y: 1920, fi: 100, mi: 100, s: [
      "2mk gray", "3mk olive", "5mk dark green", "6mk violet",
      "10mk red", "15mk dark violet", "20mk blue", "25mk brown",
    ], v: { 6: ["20mk blue (thin paper)"] } },
    { a: "sr-def", n: "Sobieski Overprints", y: 1921, fi: 120, s: [
      "6mk on 3hal gray", "10mk on 5hal green", "20mk on 10hal magenta",
      "25mk on 15hal violet", "50mk on 20hal olive", "100mk on 25hal blue",
    ] },
    { a: "sr-def", n: "Arms Definitives", y: 1924, fi: 178, s: [
      "1gr orange", "2gr olive", "3gr brown", "5gr green",
      "10gr red", "15gr violet", "20gr blue", "30gr dark green",
    ] },
    { a: "sr-def", n: "Piłsudski Definitives", y: 1927, fi: 210, mi: 245, s: [
      "5gr green", "15gr violet", "20gr blue", "25gr brown", "30gr red", "50gr dark green",
    ] },
    { a: "sr-def", n: "Eagle Definitives IV", y: 1928, fi: 220, s: [
      "1gr orange", "2gr olive", "3gr brown", "5gr green",
      "10gr carmine", "15gr violet", "20gr blue", "25gr dark brown",
    ] },
    { a: "sr-def", n: "President Mościcki", y: 1929, fi: 240, mi: 270, s: [
      "15gr dark violet", "25gr dark blue", "30gr red-brown", "50gr dark green",
    ] },
    { a: "sr-def", n: "Piłsudski Memorial", y: 1935, fi: 276, mi: 294, s: [
      "5gr green", "15gr violet", "25gr blue", "30gr red",
      "45gr dark brown", "55gr dark green",
    ] },
    { a: "sr-def", n: "Castle Definitives", y: 1936, fi: 288, s: [
      "5gr green (Wawel)", "10gr red (Vilnius)", "15gr violet (Lwów)",
      "20gr blue (Warsaw)", "25gr brown (Gdynia)", "30gr olive (Poznań)",
      "45gr dark green (Toruń)", "55gr dark blue (Kraków)",
    ] },
    { a: "sr-def", n: "Views Definitives", y: 1937, fi: 296, s: [
      "5gr green", "10gr red", "15gr violet", "25gr blue", "30gr brown", "55gr dark green",
    ] },
    { a: "sr-def", n: "Last Definitives", y: 1938, fi: 302, s: [
      "5gr green", "10gr red", "15gr violet", "25gr blue", "30gr brown", "55gr dark blue",
    ] },

    // ═══ Poland > Second Republic > Commemoratives ═══

    { a: "sr-com", n: "Constitution Anniversary", y: 1921, fi: 126, mi: 164, s: [
      "10mk dark green", "20mk red-brown", "25mk dark blue",
    ] },
    { a: "sr-com", n: "Copernicus", y: 1923, fi: 155, mi: 182, s: [
      "1000mk green", "3000mk red", "5000mk blue",
    ] },
    { a: "sr-com", n: "National Exhibition Poznań", y: 1925, fi: 196, s: [
      "5gr green", "10gr red", "15gr violet", "25gr dark blue",
    ] },
    { a: "sr-com", n: "Poznań International Fair", y: 1929, fi: 237, mi: 260, s: [
      "15gr dark violet", "25gr dark blue", "30gr red",
    ], v: { 1: ["25gr dark blue (pale shade)"] } },
    { a: "sr-com", n: "Marshal Piłsudski", y: 1934, fi: 270, mi: 280, s: [
      "5gr green", "15gr violet", "25gr blue", "75gr dark brown",
    ] },
    { a: "sr-com", n: "Gordon Bennett Cup", y: 1936, fi: 286, s: [
      "15gr dark violet", "25gr blue", "55gr dark green",
    ] },
    { a: "sr-com", n: "Polish Legion Anniversary", y: 1933, fi: 260, s: [
      "10gr red", "20gr blue", "30gr dark green", "50gr brown",
    ] },
    { a: "sr-com", n: "Scouting Jubilee", y: 1935, fi: 282, s: [
      "15gr dark violet", "25gr blue", "55gr dark green",
    ] },
    { a: "sr-com", n: "Stratospheric Balloon", y: 1938, fi: 310, s: [
      "25gr dark blue", "55gr dark brown",
    ] },
    { a: "sr-com", n: "Recovery of Cieszyn", y: 1938, fi: 312, s: [
      "15gr dark violet", "25gr blue", "55gr dark green",
    ] },

    // ═══ Poland > Second Republic > Airmail ═══

    { a: "sr-air", n: "First Airmail", y: 1925, fi: 200, mi: 224, s: [
      "5gr green", "15gr violet", "30gr blue", "45gr dark brown",
    ] },
    { a: "sr-air", n: "Airmail Definitives", y: 1929, fi: 232, mi: 254, s: [
      "5gr green", "10gr red", "50gr dark blue",
    ] },
    { a: "sr-air", n: "Pilot Żwirko & Wigura", y: 1933, fi: 258, s: [
      "30gr dark blue", "1zł dark brown",
    ] },
    { a: "sr-air", n: "Los Angeles Olympics Airmail", y: 1932, fi: 250, mi: 274, s: [
      "10gr carmine", "30gr blue", "1zł dark green",
    ] },
    { a: "sr-air", n: "Challenge Flight", y: 1934, fi: 274, mi: 284, s: [
      "20gr dark green", "30gr dark blue",
    ], v: { 1: ["30gr dark blue (perf 11½)"] } },
    { a: "sr-air", n: "Airmail Overprints", y: 1928, fi: 228, s: [
      "1zł on 5gr green", "2zł on 15gr violet", "5zł on 30gr blue",
    ] },
    { a: "sr-air", n: "Balloon Post", y: 1936, fi: 289, s: [
      "30gr dark violet", "1zł dark blue",
    ] },
    { a: "sr-air", n: "Trans-Atlantic Flight", y: 1934, fi: 276, s: [
      "30gr dark blue", "1zł dark brown",
    ] },

    // ═══ Poland > Second Republic > Officials & Postage Due ═══

    { a: "sr-off", n: "First Officials", y: 1920, fi: 1, fiPfx: "D", s: [
      "6hal violet", "10hal red", "15hal gray", "20hal olive", "25hal blue", "50hal brown",
    ] },
    { a: "sr-off", n: "Second Officials", y: 1923, fi: 7, fiPfx: "D", s: [
      "1000mk green", "2000mk red", "5000mk blue", "10000mk brown",
    ] },
    { a: "sr-off", n: "Postage Due I", y: 1919, fi: 1, fiPfx: "P", s: [
      "2hal olive", "5hal green", "10hal red", "15hal violet", "20hal blue", "50hal brown",
    ] },
    { a: "sr-off", n: "Postage Due II", y: 1921, fi: 7, fiPfx: "P", s: [
      "20mk green", "50mk red", "100mk blue", "200mk brown",
    ] },
    { a: "sr-off", n: "Postage Due III", y: 1924, fi: 15, fiPfx: "P", s: [
      "1gr olive", "2gr brown", "5gr green", "10gr red", "20gr blue", "50gr dark violet",
    ] },
    { a: "sr-off", n: "Court Fee Stamps", y: 1928, fi: 1, fiPfx: "C", s: [
      "50gr green", "1zł red", "5zł dark blue",
    ] },

    // ═══ Poland > General Government 1939–1945 ═══

    { a: "gg", n: "Hitler Overprints", y: 1940, fi: 1, fiPfx: "GG", mi: 14, s: [
      "6gr on 5gr green", "8gr on 5gr green", "10gr on 10gr red", "12gr on 15gr violet",
      "20gr on 20gr blue", "24gr on 25gr brown", "30gr on 30gr olive", "50gr on 50gr dark green",
    ] },
    { a: "gg", n: "Castles and Landscapes", y: 1940, fi: 40, fiPfx: "GG", mi: 40, s: [
      "1gr olive (Krakow)", "3gr brown (Wawel)", "6gr green (Lublin)",
      "12gr red (Warsaw)", "24gr blue (Częstochowa)", "50gr dark violet (Zamość)",
    ] },
    { a: "gg", n: "First Anniversary", y: 1940, fi: 50, fiPfx: "GG", s: [
      "12gr dark green", "24gr red-brown", "30gr dark blue", "50gr dark violet",
    ] },
    { a: "gg", n: "Red Cross", y: 1940, fi: 56, fiPfx: "GG", s: [
      "12+8gr dark green", "24+26gr red", "30+30gr blue",
    ] },
    { a: "gg", n: "Copernicus", y: 1942, fi: 89, fiPfx: "GG", s: [
      "12gr dark green", "24gr red-brown", "30gr dark blue",
    ] },
    { a: "gg", n: "Hitler Definitives", y: 1941, fi: 71, fiPfx: "GG", mi: 71, s: [
      "1gr olive", "3gr brown", "6gr green", "12gr red", "24gr blue", "50gr dark violet",
    ] },
    { a: "gg", n: "Kraków Buildings", y: 1943, fi: 104, fiPfx: "GG", s: [
      "12gr dark green", "20gr blue", "24gr red-brown", "50gr dark violet",
    ] },
    { a: "gg", n: "Fourth Anniversary", y: 1943, fi: 110, fiPfx: "GG", s: [
      "12gr dark green", "20gr blue", "24gr red-brown", "30gr dark olive",
    ] },

    // ═══ Poland > People's Republic > Definitives ═══

    { a: "prl-def", n: "Liberation Definitives", y: 1945, fi: 350, s: [
      "1zł green", "2zł red", "3zł violet", "5zł blue", "10zł brown", "25zł dark green",
    ] },
    { a: "prl-def", n: "Reconstruction", y: 1947, fi: 420, s: [
      "1zł olive", "2zł brown", "3zł green", "5zł red", "10zł blue", "20zł dark violet",
    ] },
    { a: "prl-def", n: "Workers", y: 1950, fi: 500, mi: 580, s: [
      "5gr brown", "10gr green", "15gr violet", "20gr blue",
      "25gr dark red", "30gr olive", "40gr magenta", "45gr dark brown",
    ] },
    { a: "prl-def", n: "National Emblems", y: 1952, fi: 600, s: [
      "5gr green", "10gr red", "15gr violet", "20gr blue", "30gr brown", "45gr dark green",
    ] },
    { a: "prl-def", n: "Transport", y: 1953, fi: 650, s: [
      "5gr olive (locomotive)", "10gr red (bus)", "15gr blue (ship)",
      "20gr violet (airplane)", "30gr brown (truck)", "45gr green (tram)",
    ] },
    { a: "prl-def", n: "Architecture", y: 1955, fi: 750, s: [
      "5gr green (Palace of Culture)", "10gr red (Nowa Huta)", "15gr violet (Marszałkowska)",
      "20gr blue (MDM)", "25gr brown (Łazienki)", "30gr olive (Sigismund's Column)",
      "40gr magenta (Barbican)", "60gr dark blue (Town Hall)",
    ] },
    { a: "prl-def", n: "Industry", y: 1956, fi: 800, s: [
      "5gr green (steelworks)", "10gr red (coal mine)", "15gr violet (textile)",
      "20gr blue (chemical plant)", "40gr brown (shipyard)", "60gr dark green (tractor factory)",
    ] },
    { a: "prl-def", n: "Ships", y: 1958, fi: 920, s: [
      "40gr olive (galeon)", "60gr red (steamship)", "95gr violet (icebreaker)",
      "1.50zł blue (tanker)", "2.50zł brown (passenger liner)", "6.50zł dark green (cargo vessel)",
    ] },
    { a: "prl-def", n: "Aviation", y: 1959, fi: 960, s: [
      "40gr green (biplane)", "60gr red (PZL fighter)", "95gr violet (transport)",
      "1.50zł blue (jet trainer)", "2.50zł brown (helicopter)", "6.50zł dark blue (airliner)",
    ] },
    { a: "prl-def", n: "Heads of State", y: 1960, fi: 1010, s: [
      "40gr green", "60gr red", "1.50zł blue", "2.50zł brown",
    ] },
    { a: "prl-def", n: "Landscapes", y: 1963, fi: 1280, s: [
      "20gr green (Tatra)", "30gr red (Bieszczady)", "40gr violet (Mazury)",
      "60gr blue (Baltic)", "90gr brown (Sudety)", "1.35zł olive (Wielkopolska)",
      "2.50zł dark blue (Roztocze)", "6.50zł dark green (Karkonosze)",
    ] },
    { a: "prl-def", n: "Folk Art", y: 1965, fi: 1480, s: [
      "20gr green (Łowicz)", "40gr red (Kurpie)", "60gr violet (Kraków region)",
      "1.50zł blue (Kaszuby)", "2.50zł brown (Podhale)", "6.50zł dark olive (Silesia)",
    ] },

    // ═══ Poland > People's Republic > Commemoratives ═══

    { a: "prl-com", n: "Liberation Anniversary", y: 1945, fi: 362, s: [
      "1zł green", "3zł red", "6zł dark blue",
    ] },
    { a: "prl-com", n: "Labour Day", y: 1950, fi: 510, s: [
      "15gr green", "25gr red", "45gr dark blue",
    ] },
    { a: "prl-com", n: "Stalin", y: 1953, fi: 660, s: [
      "45gr dark green", "60gr dark blue",
    ] },
    { a: "prl-com", n: "Warsaw Uprising Anniversary", y: 1954, fi: 710, s: [
      "20gr green", "40gr red", "60gr violet", "1.55zł dark blue",
    ] },
    { a: "prl-com", n: "Famous Poles", y: 1959, fi: 970, mi: 1132, s: [
      "Copernicus 40gr", "Curie-Skłodowska 60gr", "Chopin 1.50zł",
      "Mickiewicz 2.50zł", "Kościuszko 3.40zł", "Staszic 6.50zł",
    ] },
    { a: "prl-com", n: "Polish Workers Party", y: 1961, fi: 1100, s: [
      "40gr green", "60gr red", "2.50zł dark blue",
    ] },
    { a: "prl-com", n: "Millennium of Poland", y: 1966, fi: 1520, mi: 1675, s: [
      "20gr green", "40gr red", "60gr violet",
      "1.50zł blue", "2.50zł brown", "6.50zł dark olive",
    ] },
    { a: "prl-com", n: "Lenin Centenary", y: 1970, fi: 1850, s: [
      "40gr green", "60gr red", "2.50zł dark blue",
    ] },
    { a: "prl-com", n: "Liberation 30th Anniversary", y: 1975, fi: 2200, s: [
      "1zł green", "1.50zł red", "4zł blue", "6.50zł dark brown",
    ] },
    { a: "prl-com", n: "Solidarity", y: 1981, fi: 2600, s: [
      "2zł green", "6zł red", "25zł dark blue",
    ] },
    { a: "prl-com", n: "Katowice Steelworks", y: 1976, fi: 2280, s: [
      "1zł green", "1.50zł red", "6zł dark blue",
    ] },
    { a: "prl-com", n: "Warsaw Pact Anniversary", y: 1980, fi: 2520, s: [
      "1zł green", "2zł red", "6zł blue", "8.40zł dark brown",
    ] },

    // ═══ Poland > People's Republic > Thematic ═══

    { a: "prl-the", n: "Olympic Games Tokyo", y: 1964, fi: 1393, mi: 1522, s: [
      "Boxing 20gr", "Fencing 40gr", "Athletics 60gr",
      "Cycling 1.50zł", "Rowing 2.50zł", "Sailing 6.50zł",
    ] },
    { a: "prl-the", n: "Space Exploration", y: 1966, fi: 1530, mi: 1684, s: [
      "Sputnik 20gr", "Vostok 40gr", "Gemini 60gr",
      "Luna 1.50zł", "Ranger 2.50zł", "Apollo 6.50zł",
    ], opt: [5], v: { 0: ["Sputnik 20gr (darker shade)"] } },
    { a: "prl-the", n: "Wildflowers", y: 1967, fi: 1600, s: [
      "Cornflower 20gr", "Poppy 40gr", "Daisy 60gr", "Bluebell 90gr",
      "Clover 1.35zł", "Buttercup 1.50zł", "Primrose 2.50zł", "Gentian 7zł",
    ] },
    { a: "prl-the", n: "Insects", y: 1962, fi: 1200, s: [
      "Ladybug 20gr", "Stag beetle 40gr", "Dragonfly 60gr",
      "Butterfly 1.50zł", "Bumblebee 2.50zł", "Praying mantis 6.50zł",
    ] },
    { a: "prl-the", n: "Butterflies", y: 1967, fi: 1620, s: [
      "Swallowtail 20gr", "Peacock 40gr", "Apollo 60gr", "Admiral 90gr",
      "Brimstone 1.35zł", "Painted Lady 1.50zł", "Copper 2.50zł", "Camberwell Beauty 7zł",
    ] },
    { a: "prl-the", n: "Mushrooms", y: 1959, fi: 980, s: [
      "Boletus 40gr", "Chanterelle 60gr", "Russula 95gr",
      "Amanita 1.50zł", "Morel 2.50zł", "Parasol 6.50zł",
    ] },
    { a: "prl-the", n: "Dogs", y: 1963, fi: 1300, s: [
      "German Shepherd 20gr", "Greyhound 30gr", "Pointer 40gr", "Boxer 60gr",
      "Dachshund 90gr", "Setter 1.35zł", "Spaniel 2.50zł", "Great Dane 6.50zł",
    ] },
    { a: "prl-the", n: "Cats", y: 1964, fi: 1380, s: [
      "Siamese 20gr", "Persian 40gr", "Tabby 60gr",
      "Angora 1.50zł", "Abyssinian 2.50zł", "European shorthair 6.50zł",
    ] },
    { a: "prl-the", n: "Fish", y: 1958, fi: 910, s: [
      "Pike 40gr", "Trout 60gr", "Perch 95gr",
      "Carp 1.50zł", "Salmon 2.50zł", "Sturgeon 6.50zł",
    ] },
    { a: "prl-the", n: "Paintings", y: 1968, fi: 1700, s: [
      "Matejko 20gr", "Wyspiański 30gr", "Malczewski 40gr", "Chełmoński 60gr",
      "Gierymski 1.35zł", "Rodakowski 1.50zł", "Kossak 2.50zł", "Mehoffer 7zł",
    ] },
    { a: "prl-the", n: "Olympic Games Munich", y: 1972, fi: 2020, mi: 2190, s: [
      "Boxing 20gr", "Wrestling 40gr", "Weightlifting 60gr",
      "Volleyball 1.50zł", "Sprint 2.50zł", "Pole vault 8.40zł",
    ] },
    { a: "prl-the", n: "World Cup Argentina", y: 1978, fi: 2400, s: [
      "Goalkeeper 50gr", "Heading 1zł", "Dribble 1.50zł",
      "Free kick 2zł", "Tackle 6zł", "Trophy 8.40zł",
    ] },
    { a: "prl-the", n: "Dinosaurs", y: 1965, fi: 1450, s: [
      "Tyrannosaurus 20gr", "Brontosaurus 40gr", "Stegosaurus 60gr",
      "Triceratops 1.50zł", "Pteranodon 2.50zł", "Diplodocus 6.50zł",
    ] },
    { a: "prl-the", n: "Sailing Ships", y: 1963, fi: 1310, s: [
      "Viking longship 20gr", "Caravel 40gr", "Galleon 60gr",
      "Clipper 1.50zł", "Frigate 2.50zł", "Full-rigged ship 6.50zł",
    ] },
    { a: "prl-the", n: "Tropical Fish", y: 1967, fi: 1610, s: [
      "Angelfish 20gr", "Discus 40gr", "Guppy 60gr",
      "Neon tetra 1.50zł", "Swordtail 2.50zł", "Oscar 6.50zł",
    ] },
    { a: "prl-the", n: "Famous Scientists", y: 1973, fi: 2100, s: [
      "Copernicus 1zł", "Śniadecki 1.50zł", "Marian Smoluchowski 4zł", "Stefan Banach 6.50zł",
    ] },

    // ═══ Poland > Third Republic 1989–present ═══

    { a: "3rp", n: "Solidarity Heroes", y: 1990, fi: 3100, s: [
      "1500zł green", "2500zł red", "3000zł blue", "5000zł brown",
    ] },
    { a: "3rp", n: "Europa CEPT", y: 1993, fi: 3300, mi: 3445, s: [
      "2000zł multicolored", "5000zł multicolored",
    ] },
    { a: "3rp", n: "Polish Castles", y: 1995, fi: 3400, s: [
      "45gr green (Malbork)", "60gr red (Wawel)", "80gr violet (Łańcut)",
      "1zł blue (Baranów)", "1.40zł brown (Krasiczyn)", "2zł dark green (Książ)",
    ] },
    { a: "3rp", n: "Christmas", y: 1997, fi: 3520, s: [
      "50gr gold (Nativity)", "80gr blue (Star)", "1.40zł red (Magi)",
    ] },
    { a: "3rp", n: "Polish Pope", y: 2000, fi: 3700, s: [
      "70gr green", "1zł blue", "1.60zł violet",
    ] },
    { a: "3rp", n: "EU Accession", y: 2004, fi: 3970, mi: 4110, s: [
      "1.25zł multicolored", "2.10zł multicolored", "3.45zł multicolored", "4.75zł multicolored",
    ] },
    { a: "3rp", n: "Warsaw Uprising 60th", y: 2004, fi: 3980, s: [
      "1.25zł green", "2.10zł red", "3.45zł dark blue",
    ] },
    { a: "3rp", n: "Benedict XVI Visit", y: 2006, fi: 4100, s: [
      "1.30zł multicolored", "3.50zł multicolored",
    ] },
    { a: "3rp", n: "Euro 2012 Football", y: 2012, fi: 4400, mi: 4568, s: [
      "1.55zł multicolored (stadium)", "3zł multicolored (mascot)",
      "4.15zł multicolored (trophy)", "5zł multicolored (ball)",
    ] },
    { a: "3rp", n: "Independence Centenary", y: 2018, fi: 4900, s: [
      "2.60zł green", "3.20zł red", "5zł blue", "8.50zł brown",
    ] },

    // ═══ Germany > German Empire 1872–1918 ═══

    { a: "de-emp", n: "Brustschilde Large", y: 1872, mi: 1, s: [
      "¼gr violet", "⅓gr green", "½gr orange", "1gr rose",
      "2gr blue", "2½gr brown", "5gr ochre", "18kr red",
    ] },
    { a: "de-emp", n: "Pfennige", y: 1875, mi: 31, s: [
      "3pf green", "5pf violet", "10pf rose", "20pf ultramarine", "25pf brown", "50pf gray",
    ] },
    { a: "de-emp", n: "Krone / Adler", y: 1880, mi: 39, s: [
      "3pf light green", "5pf violet", "10pf rose", "20pf blue", "25pf orange-brown", "50pf olive-green",
    ] },
    { a: "de-emp", n: "Reichspost Numbers", y: 1889, mi: 45, s: [
      "2pf gray", "3pf brown", "5pf green", "10pf carmine", "20pf ultramarine", "25pf orange",
    ], v: { 3: ["10pf carmine (deep shade)"] } },
    { a: "de-emp", n: "Germania Definitives I", y: 1900, mi: 53, s: [
      "2pf gray", "3pf brown", "5pf green", "10pf carmine",
      "20pf ultramarine", "25pf orange", "30pf olive", "50pf chocolate",
    ] },
    { a: "de-emp", n: "Germania Definitives II", y: 1905, mi: 83, s: [
      "2pf gray", "3pf brown", "5pf green", "10pf carmine", "20pf blue", "25pf orange",
    ] },
    { a: "de-emp", n: "War Charity", y: 1917, mi: 97, s: [
      "2½+2½pf gray", "5+5pf green", "7½+7½pf brown-orange", "15+5pf dark violet",
    ] },
    { a: "de-emp", n: "Inflation Overprints", y: 1920, mi: 107, s: [
      "10pf on 7½pf orange", "15pf on 10pf carmine", "20pf on 15pf violet",
      "30pf on 20pf blue", "40pf on 30pf olive", "75pf on 50pf chocolate",
    ] },

    // ═══ Germany > Weimar Republic 1919–1933 ═══

    { a: "de-wei", n: "National Assembly", y: 1919, mi: 107, s: [
      "10pf red", "15pf dark violet", "25pf orange-brown",
    ] },
    { a: "de-wei", n: "Workers Definitives", y: 1921, mi: 119, s: [
      "5pf green", "10pf red", "15pf violet", "20pf blue",
      "40pf red-brown", "60pf dark olive", "80pf rose", "2mk dark blue",
    ] },
    { a: "de-wei", n: "Hyperinflation", y: 1923, mi: 313, s: [
      "100Tsd red", "200Tsd green", "500Tsd blue", "2Mio brown",
      "5Mio violet", "10Mio olive", "20Mio orange", "50Mio dark blue",
    ] },
    { a: "de-wei", n: "Eagle Definitives", y: 1924, mi: 355, s: [
      "3pf light brown", "5pf green", "10pf carmine", "15pf red", "20pf blue", "40pf olive",
    ] },
    { a: "de-wei", n: "Beethoven", y: 1927, mi: 403, s: [
      "3pf dark brown", "8pf dark green", "25pf dark blue",
    ] },
    { a: "de-wei", n: "Nothilfe Welfare", y: 1928, mi: 425, s: [
      "3+2pf olive", "5+5pf green", "8+4pf brown", "25+10pf dark blue",
    ] },
    { a: "de-wei", n: "Hindenburg Definitives", y: 1928, mi: 410, s: [
      "1pf black", "3pf brown", "5pf green", "10pf carmine", "15pf red", "25pf dark blue",
    ], v: { 3: ["10pf carmine (perf 14)"] } },
    { a: "de-wei", n: "IPOSTA Exhibition", y: 1930, mi: 446, s: [
      "8+4pf dark green", "15+15pf dark red", "25+25pf dark blue", "50+50pf dark brown",
    ] },

    // ═══ Germany > Third Reich 1933–1945 ═══

    { a: "de-3r", n: "Hindenburg Medallion", y: 1933, mi: 512, s: [
      "1pf black", "3pf brown", "4pf dark blue", "5pf green",
      "6pf dark green", "8pf orange", "12pf red", "25pf ultramarine",
    ] },
    { a: "de-3r", n: "Trades", y: 1934, mi: 556, s: [
      "3pf brown (farmer)", "5pf green (smith)", "6pf dark green (miner)",
      "8pf orange (builder)", "12pf red (chemist)", "25pf blue (sailor)",
    ] },
    { a: "de-3r", n: "Olympic Games Berlin", y: 1936, mi: 609, s: [
      "3+2pf brown (torch)", "4+3pf gray (discus)", "6+4pf green (football)",
      "8+4pf orange (spring)", "12+6pf red (rowing)", "15+10pf violet (fencing)",
      "25+15pf blue (equestrian)", "40+35pf olive (diving)",
    ] },
    { a: "de-3r", n: "Hitler Birthday", y: 1937, mi: 646, s: [
      "6pf dark green", "12pf carmine", "42pf dark blue",
    ] },
    { a: "de-3r", n: "Motor Show", y: 1939, mi: 686, s: [
      "6pf dark green", "12pf carmine", "25pf dark blue",
    ] },
    { a: "de-3r", n: "Postal Congress", y: 1939, mi: 698, s: [
      "3pf brown", "6pf green", "12pf red", "25pf blue",
    ] },
    { a: "de-3r", n: "Armed Forces Day", y: 1943, mi: 831, s: [
      "3+2pf brown", "4+3pf gray", "5+3pf green",
      "6+4pf dark green", "8+4pf orange", "12+6pf red",
    ] },
    { a: "de-3r", n: "Postal Employees", y: 1944, mi: 888, s: [
      "6+4pf dark green", "8+4pf orange", "12+8pf red", "24+16pf dark blue",
    ] },

    // ═══ Germany > West Germany > Definitives ═══

    { a: "brd-def", n: "Bauten Definitives", y: 1948, mi: 73, s: [
      "2pf black (Holstentor)", "4pf green (Cologne Cathedral)", "6pf olive (Munich Frauenkirche)",
      "10pf green (Flensburg gate)", "15pf red (Frankfurt Römer)", "20pf blue (Baden-Baden spa)",
      "25pf brown (St. Mary Lübeck)", "30pf red-brown (Zwinger Dresden)",
    ] },
    { a: "brd-def", n: "Posthorn Definitives", y: 1951, mi: 123, s: [
      "2pf black", "4pf green", "5pf dark green", "7pf dark blue",
      "8pf orange", "10pf green", "15pf red", "20pf blue",
    ] },
    { a: "brd-def", n: "Heuss Definitives I", y: 1954, mi: 177, s: [
      "1pf brown", "2pf black", "4pf green", "5pf dark green",
      "7pf dark blue", "8pf orange", "10pf green", "20pf blue",
    ] },
    { a: "brd-def", n: "Heuss Definitives II", y: 1956, mi: 259, s: [
      "1pf brown", "4pf green", "7pf dark blue", "8pf orange", "10pf green", "20pf blue",
    ] },
    { a: "brd-def", n: "Bedeutende Deutsche I", y: 1961, mi: 347, s: [
      "5pf green (Albertus Magnus)", "7pf dark blue (Gutenberg)", "8pf orange (Luther)",
      "10pf green (Dürer)", "15pf red (Cranach)", "20pf blue (Bach)",
      "25pf brown (Leibniz)", "40pf olive (Lessing)",
    ] },
    { a: "brd-def", n: "Bedeutende Deutsche II", y: 1964, mi: 454, s: [
      "10pf green (Dürer)", "20pf blue (Bach)", "30pf orange (Kant)",
      "40pf violet (Lessing)", "50pf olive (Goethe)", "80pf dark blue (Schiller)",
    ] },
    { a: "brd-def", n: "Brandenburger Tor", y: 1966, mi: 506, s: [
      "10pf green", "20pf blue", "30pf orange", "40pf violet", "50pf olive", "100pf dark red",
    ] },
    { a: "brd-def", n: "Heinemann Definitives", y: 1970, mi: 635, s: [
      "5pf green", "10pf olive", "20pf blue", "25pf brown",
      "30pf red", "40pf violet", "50pf dark green", "70pf dark blue",
    ] },
    { a: "brd-def", n: "Industry & Technology", y: 1975, mi: 846, s: [
      "10pf green (electricity)", "20pf blue (space)", "30pf red (radio)",
      "40pf violet (television)", "50pf olive (tractor)", "60pf brown (turbine)",
      "70pf dark blue (coal mine)", "120pf dark red (chemical plant)",
    ] },
    { a: "brd-def", n: "Castles & Palaces", y: 1977, mi: 913, s: [
      "10pf green (Glücksburg)", "20pf red (Pfaueninsel)", "30pf blue (Ludwigsburg)",
      "40pf violet (Augustusburg)", "50pf olive (Neuschwanstein)", "60pf brown (Marksburg)",
      "80pf dark blue (Wilhelmsthal)", "120pf dark red (Herrenchiemsee)",
    ], v: { 4: ["50pf olive (Neuschwanstein, fluorescent paper)"] } },

    // ═══ Germany > West Germany > Commemoratives ═══

    { a: "brd-com", n: "First Federal President", y: 1949, mi: 111, s: [
      "10pf green", "20pf blue", "30pf brown",
    ] },
    { a: "brd-com", n: "Refugees Welfare", y: 1952, mi: 148, s: [
      "4+2pf green", "10+5pf red", "20+5pf blue", "30+10pf brown",
    ] },
    { a: "brd-com", n: "Europa CEPT", y: 1956, mi: 241, s: [
      "10pf green", "40pf blue",
    ] },
    { a: "brd-com", n: "Olympic Games Munich", y: 1972, mi: 719, s: [
      "5+5pf green (running)", "10+5pf red (sailing)", "20+10pf blue (gymnastics)",
      "25+10pf brown (swimming)", "30+15pf olive (cycling)", "40+20pf violet (equestrian)",
    ] },
    { a: "brd-com", n: "Dürer Anniversary", y: 1971, mi: 677, s: [
      "10pf green", "25pf blue", "30pf red-brown",
    ] },
    { a: "brd-com", n: "World Cup 1974", y: 1974, mi: 811, s: [
      "10+5pf green", "25+10pf blue", "40+20pf red", "70+35pf dark blue",
    ] },
    { a: "brd-com", n: "Europa Architecture", y: 1978, mi: 969, s: [
      "40pf green (castle)", "70pf blue (cathedral)",
    ] },
    { a: "brd-com", n: "European Parliament", y: 1979, mi: 1000, s: [
      "40pf green", "60pf blue", "90pf brown",
    ] },
    { a: "brd-com", n: "German Unity", y: 1990, mi: 1477, s: [
      "50pf green", "100pf red", "170pf dark blue",
    ] },
    { a: "brd-com", n: "Europa Nature Conservation", y: 1986, mi: 1285, s: [
      "60pf green", "80pf blue",
    ] },

    // ═══ Germany > East Germany (DDR) 1949–1990 ═══

    { a: "ddr", n: "Pieck Definitives", y: 1950, mi: 251, s: [
      "6pf dark green", "8pf red", "10pf brown", "12pf carmine",
      "16pf dark blue", "20pf blue", "24pf orange", "30pf olive",
    ] },
    { a: "ddr", n: "Five Year Plan", y: 1953, mi: 362, s: [
      "6pf dark green (dam)", "12pf red (steelworks)", "16pf brown (housing)",
      "20pf blue (agriculture)", "24pf olive (chemical plant)", "48pf dark blue (railway)",
    ] },
    { a: "ddr", n: "Workers Definitives", y: 1955, mi: 453, s: [
      "5pf green", "10pf brown", "15pf dark blue", "20pf red", "25pf olive", "40pf violet",
    ] },
    { a: "ddr", n: "Berlin Buildings", y: 1959, mi: 691, s: [
      "5pf green (Opera)", "10pf brown (TV tower)", "15pf blue (University)",
      "20pf red (Town Hall)", "25pf olive (Brandenburg Gate)", "40pf violet (Pergamon)",
    ] },
    { a: "ddr", n: "Olympic Games Rome", y: 1960, mi: 746, s: [
      "10+5pf green (running)", "20+10pf red (boxing)", "25+10pf blue (rowing)", "40+20pf brown (cycling)",
    ] },
    { a: "ddr", n: "Space Cosmonauts", y: 1962, mi: 917, s: [
      "10pf green (Gagarin)", "20pf red (Titov)", "25pf dark blue (Tereshkova)",
    ] },
    { a: "ddr", n: "Wartburg Castle", y: 1966, mi: 1233, s: [
      "10pf green", "20pf red", "25pf blue", "50pf dark brown",
    ] },
    { a: "ddr", n: "Karl Marx Anniversary", y: 1968, mi: 1365, s: [
      "10pf green", "20pf red", "25pf dark blue",
    ] },
    { a: "ddr", n: "Socialist Construction", y: 1973, mi: 1853, s: [
      "5pf green (housing)", "10pf red (hospital)", "15pf blue (school)",
      "20pf brown (factory)", "25pf olive (railway)", "35pf dark blue (research)",
    ] },
    { a: "ddr", n: "Fairy Tales", y: 1975, mi: 2107, s: [
      "Snow White 5pf", "Rumpelstiltskin 10pf", "Sleeping Beauty 20pf",
      "Rapunzel 25pf", "Hansel and Gretel 35pf", "Cinderella 50pf",
    ] },
    { a: "ddr", n: "Children's Art", y: 1968, mi: 1408, s: [
      "5pf multicolored", "10pf multicolored", "20pf multicolored", "25pf multicolored",
    ] },
    { a: "ddr", n: "Zoo Animals", y: 1975, mi: 2030, s: [
      "Elephant 5pf", "Giraffe 10pf", "Lion 20pf",
      "Polar bear 25pf", "Gorilla 35pf", "Penguin 70pf",
    ], v: { 3: ["Polar bear 25pf (darker shade)"] } },
    { a: "ddr", n: "Railways", y: 1983, mi: 2792, s: [
      "10pf (steam locomotive)", "20pf (diesel)", "35pf (electric)", "85pf (high-speed)",
    ] },

    // ═══ Germany > Reunified Germany 1990–present ═══

    { a: "de-mod", n: "Sights Definitives I", y: 1990, mi: 1468, s: [
      "5pf green (Flensburg)", "10pf red (Celle)", "20pf blue (Lorsch)",
      "30pf brown (Goslar)", "40pf violet (Rastatt)", "50pf olive (Potsdam)",
      "60pf dark blue (Wetzlar)", "80pf dark red (Speyer)",
    ] },
    { a: "de-mod", n: "Sights Definitives II", y: 1993, mi: 1665, s: [
      "80pf dark red (Speyer)", "100pf green (Quedlinburg)", "200pf blue (Schwerin)",
      "300pf brown (Bamberg)", "400pf violet (Regensburg)", "500pf olive (Lübeck)",
    ] },
    { a: "de-mod", n: "Europa Heritage", y: 1995, mi: 1789, s: [
      "80pf green", "100pf blue",
    ] },
    { a: "de-mod", n: "Expo 2000 Hannover", y: 2000, mi: 2089, s: [
      "100pf green (pavilion)", "110pf blue (globe)", "300pf brown (mascot)",
    ] },
    { a: "de-mod", n: "World Cup 2006", y: 2006, mi: 2517, s: [
      "45ct green (stadium)", "55ct blue (mascot)", "90ct red (trophy)", "145ct violet (ball)",
    ] },
    { a: "de-mod", n: "Flowers Definitives", y: 2005, mi: 2480, s: [
      "1ct yellow (sunflower)", "2ct orange (marigold)", "5ct pink (rose)", "8ct red (dahlia)",
      "10ct green (lily-of-the-valley)", "20ct violet (crocus)", "25ct blue (forget-me-not)", "45ct magenta (peony)",
    ] },
    { a: "de-mod", n: "German Lighthouses", y: 2004, mi: 2409, s: [
      "45ct green (Warnemünde)", "55ct blue (Amrum)", "90ct red (Borkum)", "144ct brown (Pellworm)",
    ] },
    { a: "de-mod", n: "Reunification 25th", y: 2015, mi: 3182, s: [
      "62ct green", "85ct red", "145ct blue",
    ] },
    { a: "de-mod", n: "Medieval Towns", y: 2003, mi: 2309, s: [
      "45ct green (Rothenburg)", "55ct blue (Dinkelsbühl)", "144ct brown (Nördlingen)",
    ] },
    { a: "de-mod", n: "National Parks", y: 2012, mi: 2935, s: [
      "45ct green (Bavarian Forest)", "55ct blue (Saxon Switzerland)",
      "90ct brown (Jasmund)", "145ct violet (Harz)",
    ] },
  ];
}

export async function seedStamps(
  collectionId: string,
  tx: PrismaClient,
  catalog: DemoCatalog,
  areas: DemoAreas
): Promise<void> {
  const issues = buildIssues();

  for (const def of issues) {
    const areaId = areas[def.a];
    const isGerman = def.a.startsWith("de-") || def.a.startsWith("brd") || def.a === "ddr" || def.a === "de-mod";

    const issue = await tx.issue.create({
      data: {
        collectionId,
        collectionAreaId: areaId,
        name: def.n,
        year: def.y,
      },
    });

    const issueCatNums: { issueId: string; catalogVendorId: string; firstNumber: string; lastNumber: string }[] = [];
    if (def.fi != null) {
      const pfx = def.fiPfx ?? "";
      issueCatNums.push({
        issueId: issue.id,
        catalogVendorId: catalog.fischerVendorId,
        firstNumber: `${pfx}${def.fi}`,
        lastNumber: `${pfx}${def.fi + def.s.length - 1}`,
      });
    }
    if (def.mi != null) {
      issueCatNums.push({
        issueId: issue.id,
        catalogVendorId: catalog.michelVendorId,
        firstNumber: `${def.mi}`,
        lastNumber: `${def.mi + def.s.length - 1}`,
      });
    }
    if (issueCatNums.length > 0) {
      await tx.issueCatalogNumber.createMany({ data: issueCatNums });
    }

    const optSet = new Set(def.opt ?? []);
    const priceBase = priceFactor(def.y);

    for (let i = 0; i < def.s.length; i++) {
      const stamp = await tx.stamp.create({
        data: { collectionId, name: def.s[i], issuedYear: def.y },
      });

      await tx.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
      });

      await tx.issueMember.create({
        data: { issueId: issue.id, stampId: stamp.id, requiredForCompleteness: !optSet.has(i) },
      });

      const catNums: { stampId: string; catalogVendorId: string; number: string }[] = [];
      if (def.fi != null) {
        catNums.push({ stampId: stamp.id, catalogVendorId: catalog.fischerVendorId, number: `${def.fiPfx ?? ""}${def.fi + i}` });
      }
      if (def.mi != null) {
        catNums.push({ stampId: stamp.id, catalogVendorId: catalog.michelVendorId, number: `${def.mi + i}` });
      }
      if (catNums.length > 0) {
        await tx.stampCatalogNumber.createMany({ data: catNums });
      }

      const stampPrice = round2(priceBase * (1 + i * 0.15));
      const prices: { stampId: string; catalogEditionId: string; price: number; currency: string }[] = [];
      if (def.fi != null) {
        prices.push({ stampId: stamp.id, catalogEditionId: catalog.fischerEditionId, price: stampPrice, currency: "PLN" });
      }
      if (isGerman) {
        prices.push({ stampId: stamp.id, catalogEditionId: catalog.michelDeutschlandEditionId, price: round2(stampPrice * 0.25), currency: "EUR" });
      } else if (def.mi != null) {
        prices.push({ stampId: stamp.id, catalogEditionId: catalog.michelOsteuropaEditionId, price: round2(stampPrice * 0.25), currency: "EUR" });
      }
      if (prices.length > 0) {
        await tx.stampCatalogPrice.createMany({ data: prices });
      }

      const variantNames = def.v?.[i];
      if (variantNames) {
        for (let vi = 0; vi < variantNames.length; vi++) {
          const variant = await tx.stamp.create({
            data: { collectionId, parentId: stamp.id, name: variantNames[vi], issuedYear: def.y },
          });
          await tx.stampCollectionArea.create({
            data: { stampId: variant.id, collectionAreaId: areaId, isPrimary: true },
          });

          const vCatNums: { stampId: string; catalogVendorId: string; number: string }[] = [];
          if (def.fi != null) {
            vCatNums.push({ stampId: variant.id, catalogVendorId: catalog.fischerVendorId, number: `${def.fiPfx ?? ""}${def.fi + i}a` });
          }
          if (def.mi != null) {
            vCatNums.push({ stampId: variant.id, catalogVendorId: catalog.michelVendorId, number: `${def.mi + i}I` });
          }
          if (vCatNums.length > 0) {
            await tx.stampCatalogNumber.createMany({ data: vCatNums });
          }

          const variantPrice = round2(stampPrice * 2.5);
          const vPrices: { stampId: string; catalogEditionId: string; price: number; currency: string }[] = [];
          if (def.fi != null) {
            vPrices.push({ stampId: variant.id, catalogEditionId: catalog.fischerEditionId, price: variantPrice, currency: "PLN" });
          }
          if (isGerman) {
            vPrices.push({ stampId: variant.id, catalogEditionId: catalog.michelDeutschlandEditionId, price: round2(variantPrice * 0.25), currency: "EUR" });
          } else if (def.mi != null) {
            vPrices.push({ stampId: variant.id, catalogEditionId: catalog.michelOsteuropaEditionId, price: round2(variantPrice * 0.25), currency: "EUR" });
          }
          if (vPrices.length > 0) {
            await tx.stampCatalogPrice.createMany({ data: vPrices });
          }
        }
      }
    }
  }
}

function priceFactor(year: number): number {
  if (year < 1920) return 25;
  if (year < 1945) return 15;
  if (year < 1970) return 5;
  if (year < 1990) return 3;
  return 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
