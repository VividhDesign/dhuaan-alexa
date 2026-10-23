// Builds server/src/gazetteer.json: extra localities beyond Dhuaan's 29 forecast places,
// each geocoded with Amazon Location (geo-places Geocode, same parameters as Dhuaan's api.py).
// Run once: cd server && node scripts/build-gazetteer.mjs   (needs AWS credentials)
import { GeoPlacesClient, GeocodeCommand } from "@aws-sdk/client-geo-places";
import { writeFileSync } from "node:fs";

const GRID = { lon0: 74.0, lat0: 27.6, lon1: 78.4, lat1: 31.7 };
// [id, en, hi, state, query, aliases]
const NAMES = [
  // Delhi
  ["pitampura", "Pitampura", "पीतमपुरा", "Delhi", "Pitampura, Delhi", ["pitampura"]],
  ["janakpuri", "Janakpuri", "जनकपुरी", "Delhi", "Janakpuri, Delhi", []],
  ["saket", "Saket", "साकेत", "Delhi", "Saket, New Delhi", []],
  ["lajpat_nagar", "Lajpat Nagar", "लाजपत नगर", "Delhi", "Lajpat Nagar, New Delhi", []],
  ["mayur_vihar", "Mayur Vihar", "मयूर विहार", "Delhi", "Mayur Vihar, Delhi", []],
  ["karol_bagh", "Karol Bagh", "करोल बाग", "Delhi", "Karol Bagh, New Delhi", []],
  ["vasant_kunj", "Vasant Kunj", "वसंत कुंज", "Delhi", "Vasant Kunj, New Delhi", []],
  ["anand_vihar", "Anand Vihar", "आनंद विहार", "Delhi", "Anand Vihar, Delhi", []],
  ["shahdara", "Shahdara", "शाहदरा", "Delhi", "Shahdara, Delhi", []],
  ["najafgarh", "Najafgarh", "नजफ़गढ़", "Delhi", "Najafgarh, Delhi", []],
  ["mundka", "Mundka", "मुंडका", "Delhi", "Mundka, Delhi", []],
  ["wazirpur", "Wazirpur", "वज़ीरपुर", "Delhi", "Wazirpur, Delhi", []],
  ["ashok_vihar", "Ashok Vihar", "अशोक विहार", "Delhi", "Ashok Vihar, Delhi", []],
  ["model_town", "Model Town", "मॉडल टाउन", "Delhi", "Model Town, Delhi", []],
  ["punjabi_bagh", "Punjabi Bagh", "पंजाबी बाग", "Delhi", "Punjabi Bagh, Delhi", []],
  ["rajouri_garden", "Rajouri Garden", "राजौरी गार्डन", "Delhi", "Rajouri Garden, New Delhi", []],
  ["dilshad_garden", "Dilshad Garden", "दिलशाद गार्डन", "Delhi", "Dilshad Garden, Delhi", []],
  ["okhla", "Okhla", "ओखला", "Delhi", "Okhla, New Delhi", []],
  ["greater_kailash", "Greater Kailash", "ग्रेटर कैलाश", "Delhi", "Greater Kailash, New Delhi", ["gk"]],
  ["hauz_khas", "Hauz Khas", "हौज़ ख़ास", "Delhi", "Hauz Khas, New Delhi", []],
  ["rk_puram", "R K Puram", "आर के पुरम", "Delhi", "R K Puram, New Delhi", ["rk puram", "r.k. puram"]],
  ["connaught_place", "Connaught Place", "कनॉट प्लेस", "Delhi", "Connaught Place, New Delhi", ["cp"]],
  ["chandni_chowk", "Chandni Chowk", "चांदनी चौक", "Delhi", "Chandni Chowk, Delhi", []],
  ["burari", "Burari", "बुराड़ी", "Delhi", "Burari, Delhi", []],
  ["bawana", "Bawana", "बवाना", "Delhi", "Bawana, Delhi", []],
  ["laxmi_nagar", "Laxmi Nagar", "लक्ष्मी नगर", "Delhi", "Laxmi Nagar, Delhi", ["lakshmi nagar"]],
  ["preet_vihar", "Preet Vihar", "प्रीत विहार", "Delhi", "Preet Vihar, Delhi", []],
  ["tilak_nagar", "Tilak Nagar", "तिलक नगर", "Delhi", "Tilak Nagar, New Delhi", []],
  ["uttam_nagar", "Uttam Nagar", "उत्तम नगर", "Delhi", "Uttam Nagar, New Delhi", []],
  ["paschim_vihar", "Paschim Vihar", "पश्चिम विहार", "Delhi", "Paschim Vihar, New Delhi", []],
  ["shalimar_bagh", "Shalimar Bagh", "शालीमार बाग", "Delhi", "Shalimar Bagh, Delhi", []],
  ["jahangirpuri", "Jahangirpuri", "जहांगीरपुरी", "Delhi", "Jahangirpuri, Delhi", []],
  ["chanakyapuri", "Chanakyapuri", "चाणक्यपुरी", "Delhi", "Chanakyapuri, New Delhi", []],
  ["defence_colony", "Defence Colony", "डिफ़ेंस कॉलोनी", "Delhi", "Defence Colony, New Delhi", []],
  ["kalkaji", "Kalkaji", "कालकाजी", "Delhi", "Kalkaji, New Delhi", []],
  ["mehrauli", "Mehrauli", "महरौली", "Delhi", "Mehrauli, New Delhi", []],
  ["narela_town", "Narela", "नरेला", "Delhi", "Narela, Delhi", []],
  ["vivek_vihar", "Vivek Vihar", "विवेक विहार", "Delhi", "Vivek Vihar, Delhi", []],
  ["patparganj", "Patparganj", "पटपड़गंज", "Delhi", "Patparganj, Delhi", []],
  // NCR
  ["greater_noida", "Greater Noida", "ग्रेटर नोएडा", "Uttar Pradesh", "Greater Noida, Uttar Pradesh", []],
  ["noida_sector_18", "Noida Sector 18", "नोएडा सेक्टर 18", "Uttar Pradesh", "Sector 18, Noida", ["sector 18 noida", "sector 18"]],
  ["noida_sector_62", "Noida Sector 62", "नोएडा सेक्टर 62", "Uttar Pradesh", "Sector 62, Noida", ["sector 62 noida", "sector 62"]],
  ["noida_sector_137", "Noida Sector 137", "नोएडा सेक्टर 137", "Uttar Pradesh", "Sector 137, Noida", ["sector 137 noida", "sector 137"]],
  ["indirapuram", "Indirapuram", "इंदिरापुरम", "Uttar Pradesh", "Indirapuram, Ghaziabad", []],
  ["vaishali", "Vaishali, Ghaziabad", "वैशाली, ग़ाज़ियाबाद", "Uttar Pradesh", "Vaishali, Ghaziabad", ["vaishali"]],
  ["kaushambi", "Kaushambi, Ghaziabad", "कौशांबी, ग़ाज़ियाबाद", "Uttar Pradesh", "Kaushambi, Ghaziabad", ["kaushambi"]],
  ["faridabad_nit", "Faridabad NIT", "फ़रीदाबाद एनआईटी", "Haryana", "NIT Faridabad, Haryana", ["nit faridabad"]],
  ["ballabgarh", "Ballabgarh", "बल्लभगढ़", "Haryana", "Ballabgarh, Haryana", []],
  ["manesar", "Manesar", "मानेसर", "Haryana", "Manesar, Haryana", []],
  ["sohna", "Sohna", "सोहना", "Haryana", "Sohna, Haryana", []],
  ["bahadurgarh", "Bahadurgarh", "बहादुरगढ़", "Haryana", "Bahadurgarh, Haryana", []],
  ["jhajjar", "Jhajjar", "झज्जर", "Haryana", "Jhajjar, Haryana", []],
  ["kundli", "Kundli", "कुंडली", "Haryana", "Kundli, Sonipat, Haryana", []],
  ["dlf_cyber_city", "DLF Cyber City, Gurugram", "डीएलएफ़ साइबर सिटी, गुरुग्राम", "Haryana", "DLF Cyber City, Gurugram", ["cyber city"]],
  // Punjab
  ["mohali", "Mohali", "मोहाली", "Punjab", "Mohali, Punjab", ["sas nagar"]],
  ["zirakpur", "Zirakpur", "ज़ीरकपुर", "Punjab", "Zirakpur, Punjab", []],
  ["kharar", "Kharar", "खरड़", "Punjab", "Kharar, Punjab", []],
  ["rajpura", "Rajpura", "राजपुरा", "Punjab", "Rajpura, Punjab", []],
  ["khanna", "Khanna", "खन्ना", "Punjab", "Khanna, Punjab", []],
  ["moga", "Moga", "मोगा", "Punjab", "Moga, Punjab", []],
  ["ferozepur", "Ferozepur", "फ़िरोज़पुर", "Punjab", "Ferozepur, Punjab", ["firozpur"]],
  ["faridkot", "Faridkot", "फ़रीदकोट", "Punjab", "Faridkot, Punjab", []],
  ["muktsar", "Muktsar", "मुक्तसर", "Punjab", "Sri Muktsar Sahib, Punjab", ["sri muktsar sahib"]],
  ["mansa", "Mansa", "मानसा", "Punjab", "Mansa, Punjab", []],
  ["barnala", "Barnala", "बरनाला", "Punjab", "Barnala, Punjab", []],
  ["fazilka", "Fazilka", "फ़ाज़िल्का", "Punjab", "Fazilka, Punjab", []],
  ["hoshiarpur", "Hoshiarpur", "होशियारपुर", "Punjab", "Hoshiarpur, Punjab", []],
  ["kapurthala", "Kapurthala", "कपूरथला", "Punjab", "Kapurthala, Punjab", []],
  ["phagwara", "Phagwara", "फगवाड़ा", "Punjab", "Phagwara, Punjab", []],
  ["tarn_taran", "Tarn Taran", "तरन तारन", "Punjab", "Tarn Taran, Punjab", []],
  ["gurdaspur", "Gurdaspur", "गुरदासपुर", "Punjab", "Gurdaspur, Punjab", []],
  ["malerkotla", "Malerkotla", "मलेरकोटला", "Punjab", "Malerkotla, Punjab", []],
  ["fatehgarh_sahib", "Fatehgarh Sahib", "फ़तेहगढ़ साहिब", "Punjab", "Fatehgarh Sahib, Punjab", ["sirhind"]],
  // Haryana
  ["panchkula", "Panchkula", "पंचकूला", "Haryana", "Panchkula, Haryana", []],
  ["jind", "Jind", "जींद", "Haryana", "Jind, Haryana", []],
  ["kaithal", "Kaithal", "कैथल", "Haryana", "Kaithal, Haryana", []],
  ["fatehabad", "Fatehabad", "फ़तेहाबाद", "Haryana", "Fatehabad, Haryana", []],
  ["sirsa", "Sirsa", "सिरसा", "Haryana", "Sirsa, Haryana", []],
  ["bhiwani", "Bhiwani", "भिवानी", "Haryana", "Bhiwani, Haryana", []],
  ["rewari", "Rewari", "रेवाड़ी", "Haryana", "Rewari, Haryana", []],
  ["yamunanagar", "Yamunanagar", "यमुनानगर", "Haryana", "Yamunanagar, Haryana", ["yamuna nagar"]],
  ["jagadhri", "Jagadhri", "जगाधरी", "Haryana", "Jagadhri, Haryana", []],
  ["narnaul", "Narnaul", "नारनौल", "Haryana", "Narnaul, Haryana", []],
  ["palwal", "Palwal", "पलवल", "Haryana", "Palwal, Haryana", []],
  ["hansi", "Hansi", "हांसी", "Haryana", "Hansi, Haryana", []],
  // western UP
  ["baghpat", "Baghpat", "बाग़पत", "Uttar Pradesh", "Baghpat, Uttar Pradesh", []],
  ["bulandshahr", "Bulandshahr", "बुलंदशहर", "Uttar Pradesh", "Bulandshahr, Uttar Pradesh", []],
  ["hapur", "Hapur", "हापुड़", "Uttar Pradesh", "Hapur, Uttar Pradesh", []],
  ["shamli", "Shamli", "शामली", "Uttar Pradesh", "Shamli, Uttar Pradesh", []],
  ["modinagar", "Modinagar", "मोदीनगर", "Uttar Pradesh", "Modinagar, Uttar Pradesh", []],
  ["aligarh", "Aligarh", "अलीगढ़", "Uttar Pradesh", "Aligarh, Uttar Pradesh", []],
  ["mathura", "Mathura", "मथुरा", "Uttar Pradesh", "Mathura, Uttar Pradesh", []],
  // Rajasthan
  ["sri_ganganagar", "Sri Ganganagar", "श्रीगंगानगर", "Rajasthan", "Sri Ganganagar, Rajasthan", ["ganganagar"]],
  ["hanumangarh", "Hanumangarh", "हनुमानगढ़", "Rajasthan", "Hanumangarh, Rajasthan", []],
  ["alwar", "Alwar", "अलवर", "Rajasthan", "Alwar, Rajasthan", []],
];

const geo = new GeoPlacesClient({ region: process.env.AWS_REGION ?? "ap-south-1" });
const out = [];
const dropped = [];
for (const [id, en, hi, state, query, aliases] of NAMES) {
  const r = await geo.send(new GeocodeCommand({
    QueryText: query, MaxResults: 1, Filter: { IncludeCountries: ["IND"] }, BiasPosition: [77.1, 28.7],
  }));
  const it = r.ResultItems?.[0];
  if (!it?.Position) { dropped.push(`${id}: no result`); continue; }
  const [lon, lat] = it.Position;
  const region = it.Address?.Region?.Name ?? "";
  const inside = lon >= GRID.lon0 && lon <= GRID.lon1 && lat >= GRID.lat0 && lat <= GRID.lat1;
  const stateOk = region.toLowerCase().includes(state.toLowerCase().split(" ")[0]) ||
    (state === "Delhi" && /delhi/i.test(region));
  if (!inside || !stateOk) { dropped.push(`${id}: ${it.Title} (${region}) ${lat},${lon}`); continue; }
  out.push({ id, name: { en, hi }, aliases, lat: +lat.toFixed(4), lon: +lon.toFixed(4), state, src: "amazon-location" });
}
writeFileSync(new URL("../src/gazetteer.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`kept ${out.length}/${NAMES.length}`);
if (dropped.length) console.log("dropped:\n " + dropped.join("\n "));
