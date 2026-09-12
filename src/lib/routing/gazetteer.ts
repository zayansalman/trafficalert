import type { LatLng } from "@/types/routing";

export interface GazetteerEntry {
  /** Canonical display name. */
  name: string;
  location: LatLng;
  /**
   * Extra spellings users and the Facebook group actually type, including common
   * Banglish transliterations. Matched case- and punctuation-insensitively, so
   * only add forms that differ by more than casing or a hyphen.
   */
  aliases?: string[];
}

/**
 * Hand-curated landmarks for Dhaka and its commuter belt.
 *
 * Deliberately the first stop before Nominatim: OSM search resolves "Dhanmondi 27" or
 * "Bijoy Sarani" poorly or not at all, is rate-limited to one request per second, and asks
 * that heavy use be self-hosted. These are the places the crowd-sourced reports name, so
 * resolving them offline keeps the common path fast and keeps us inside Nominatim's policy.
 *
 * Coordinates are the practical centre of each area (the roundabout, junction or main
 * crossing people mean when they say the name). Accuracy of a few hundred metres is fine:
 * the router snaps every waypoint to the nearest drivable road.
 */
export const DHAKA_GAZETTEER: GazetteerEntry[] = [
  // --- Gulshan / Banani / Baridhara ---
  { name: "Gulshan 1", location: { lat: 23.7806, lng: 90.4142 }, aliases: ["gulshan", "gulshan one", "gulshan circle 1"] },
  { name: "Gulshan 2", location: { lat: 23.7925, lng: 90.4152 }, aliases: ["gulshan two", "gulshan circle 2"] },
  { name: "Banani", location: { lat: 23.7937, lng: 90.4066 }, aliases: ["banani 11", "kakoli"] },
  { name: "Baridhara", location: { lat: 23.8020, lng: 90.4210 }, aliases: ["baridhara diplomatic zone"] },
  { name: "Bashundhara R/A", location: { lat: 23.8203, lng: 90.4270 }, aliases: ["bashundhara", "basundhara", "bashundhara residential area"] },
  { name: "Notun Bazar", location: { lat: 23.7950, lng: 90.4250 }, aliases: ["natun bazar", "notun bazaar"] },
  { name: "Badda", location: { lat: 23.7808, lng: 90.4257 }, aliases: ["merul badda", "middle badda"] },
  { name: "Kuril Bishwa Road", location: { lat: 23.8200, lng: 90.4200 }, aliases: ["kuril", "kuril flyover", "bishwa road"] },

  // --- Mohakhali / Tejgaon / Farmgate ---
  { name: "Mohakhali", location: { lat: 23.7776, lng: 90.4058 }, aliases: ["mohakhali bus terminal", "mohakhali flyover", "mohakhli"] },
  { name: "Tejgaon", location: { lat: 23.7650, lng: 90.3950 }, aliases: ["tejgaon industrial area", "nabisco"] },
  { name: "Nakhalpara", location: { lat: 23.7720, lng: 90.3930 } },
  { name: "Farmgate", location: { lat: 23.7583, lng: 90.3897 }, aliases: ["farm gate", "farmgate more"] },
  { name: "Bijoy Sarani", location: { lat: 23.7639, lng: 90.3853 }, aliases: ["bijoy soroni", "bijoy shoroni", "vijoy sarani", "bijoy sharani"] },
  { name: "Manik Mia Avenue", location: { lat: 23.7625, lng: 90.3790 }, aliases: ["manik mia", "manik miah avenue", "sangsad bhaban", "parliament"] },
  { name: "Agargaon", location: { lat: 23.7780, lng: 90.3780 }, aliases: ["agargoan", "ibn sina agargaon"] },
  { name: "Karwan Bazar", location: { lat: 23.7509, lng: 90.3928 }, aliases: ["kawran bazar", "karwan bazaar", "kawran bazaar"] },
  { name: "Panthapath", location: { lat: 23.7520, lng: 90.3870 }, aliases: ["panthopath", "panthapath signal"] },

  // --- Dhanmondi / Mohammadpur ---
  { name: "Dhanmondi", location: { lat: 23.7461, lng: 90.3742 }, aliases: ["dhanmondhi", "danmondi", "dhanmondi r/a"] },
  { name: "Dhanmondi 27", location: { lat: 23.7539, lng: 90.3746 }, aliases: ["dhanmondi twenty seven", "27 no", "dhanmondi 27 number"] },
  { name: "Dhanmondi 32", location: { lat: 23.7543, lng: 90.3782 }, aliases: ["dhanmondi thirty two", "bangabandhu museum"] },
  { name: "Jigatola", location: { lat: 23.7400, lng: 90.3740 }, aliases: ["zigatola"] },
  { name: "Kalabagan", location: { lat: 23.7477, lng: 90.3831 } },
  { name: "Science Lab", location: { lat: 23.7385, lng: 90.3833 }, aliases: ["science laboratory", "sciencelab"] },
  { name: "Shankar", location: { lat: 23.7440, lng: 90.3660 }, aliases: ["shongkor"] },
  { name: "Satmasjid Road", location: { lat: 23.7480, lng: 90.3690 }, aliases: ["sat masjid road", "shatmasjid road"] },
  { name: "Mohammadpur", location: { lat: 23.7583, lng: 90.3583 }, aliases: ["mohammadpur bus stand", "town hall"] },
  { name: "Lalmatia", location: { lat: 23.7570, lng: 90.3660 } },
  { name: "Asad Gate", location: { lat: 23.7590, lng: 90.3720 }, aliases: ["asadgate", "asad avenue"] },
  { name: "Shyamoli", location: { lat: 23.7743, lng: 90.3663 }, aliases: ["shyamali", "shamoli"] },

  // --- Mirpur / Pallabi / Uttara ---
  { name: "Mirpur 1", location: { lat: 23.7983, lng: 90.3540 }, aliases: ["mirpur one"] },
  { name: "Mirpur 10", location: { lat: 23.8069, lng: 90.3687 }, aliases: ["mirpur ten", "mirpur 10 circle", "mirpur 10 golchattar"] },
  { name: "Mirpur 11", location: { lat: 23.8180, lng: 90.3660 } },
  { name: "Mirpur 12", location: { lat: 23.8280, lng: 90.3660 } },
  { name: "Mirpur 14", location: { lat: 23.7930, lng: 90.3760 } },
  { name: "Kazipara", location: { lat: 23.7952, lng: 90.3737 } },
  { name: "Shewrapara", location: { lat: 23.7898, lng: 90.3760 }, aliases: ["sewrapara"] },
  { name: "Kalyanpur", location: { lat: 23.7920, lng: 90.3590 } },
  { name: "Gabtoli", location: { lat: 23.7830, lng: 90.3420 }, aliases: ["gabtali", "gabtoli bus terminal"] },
  { name: "Pallabi", location: { lat: 23.8230, lng: 90.3650 } },
  { name: "Kachukhet", location: { lat: 23.8100, lng: 90.3900 } },
  { name: "ECB Chattar", location: { lat: 23.8250, lng: 90.3880 }, aliases: ["ecb", "ecb circle"] },
  { name: "Airport", location: { lat: 23.8433, lng: 90.3978 }, aliases: ["hazrat shahjalal international airport", "shahjalal airport", "dhaka airport", "bimanbandar"] },
  { name: "Khilkhet", location: { lat: 23.8290, lng: 90.4197 } },
  { name: "Uttara", location: { lat: 23.8759, lng: 90.3795 }, aliases: ["uttara sector 7", "house building", "rajlakshmi"] },
  { name: "Abdullahpur", location: { lat: 23.8800, lng: 90.4000 } },
  { name: "Tongi", location: { lat: 23.8900, lng: 90.4050 } },

  // --- Central / Old Dhaka ---
  { name: "Shahbagh", location: { lat: 23.7383, lng: 90.3956 }, aliases: ["shahbag", "shahabag"] },
  { name: "Banglamotor", location: { lat: 23.7440, lng: 90.3930 }, aliases: ["bangla motor", "banglamotor signal"] },
  { name: "Moghbazar", location: { lat: 23.7480, lng: 90.4050 }, aliases: ["mogbazar", "moghbazar flyover"] },
  { name: "Malibagh", location: { lat: 23.7500, lng: 90.4130 }, aliases: ["malibag", "malibagh rail gate"] },
  { name: "Mouchak", location: { lat: 23.7452, lng: 90.4100 }, aliases: ["mouchak flyover"] },
  { name: "Shantinagar", location: { lat: 23.7400, lng: 90.4120 } },
  { name: "Kakrail", location: { lat: 23.7370, lng: 90.4060 } },
  { name: "Bailey Road", location: { lat: 23.7390, lng: 90.4030 }, aliases: ["baily road", "new baily road"] },
  { name: "Paltan", location: { lat: 23.7340, lng: 90.4130 }, aliases: ["purana paltan", "paltan mor"] },
  { name: "Motijheel", location: { lat: 23.7330, lng: 90.4172 }, aliases: ["motijhil", "shapla chattar"] },
  { name: "Gulistan", location: { lat: 23.7250, lng: 90.4100 }, aliases: ["zero point", "gulistan bus stand"] },
  { name: "Kamalapur", location: { lat: 23.7320, lng: 90.4260 }, aliases: ["kamalapur railway station"] },
  { name: "New Market", location: { lat: 23.7335, lng: 90.3846 }, aliases: ["newmarket", "nilkhet"] },
  { name: "Azimpur", location: { lat: 23.7280, lng: 90.3830 } },
  { name: "Dhaka University", location: { lat: 23.7330, lng: 90.3930 }, aliases: ["du", "tsc", "curzon hall"] },
  { name: "Elephant Road", location: { lat: 23.7390, lng: 90.3870 } },
  { name: "Lalbagh", location: { lat: 23.7190, lng: 90.3880 }, aliases: ["lalbagh fort", "old dhaka"] },
  { name: "Sadarghat", location: { lat: 23.7050, lng: 90.4100 } },
  { name: "Jatrabari", location: { lat: 23.7100, lng: 90.4340 }, aliases: ["jatrabari flyover", "jatrabri"] },
  { name: "Postogola", location: { lat: 23.7000, lng: 90.4200 }, aliases: ["postogola bridge"] },

  // --- East Dhaka ---
  { name: "Hatirjheel", location: { lat: 23.7570, lng: 90.4030 }, aliases: ["hatir jheel"] },
  { name: "Rampura", location: { lat: 23.7610, lng: 90.4210 }, aliases: ["rampura bridge", "rampura tv centre"] },
  { name: "Banasree", location: { lat: 23.7600, lng: 90.4300 }, aliases: ["banashree"] },
  { name: "Aftabnagar", location: { lat: 23.7650, lng: 90.4350 }, aliases: ["aftab nagar"] },
  { name: "Khilgaon", location: { lat: 23.7500, lng: 90.4250 }, aliases: ["khilgaon flyover"] },
  { name: "Basabo", location: { lat: 23.7400, lng: 90.4300 }, aliases: ["bashabo"] },
  { name: "Mugda", location: { lat: 23.7350, lng: 90.4280 } },

  // --- Commuter belt ---
  { name: "Savar", location: { lat: 23.8583, lng: 90.2667 } },
  { name: "Gazipur", location: { lat: 23.9999, lng: 90.4203 }, aliases: ["gazipur chowrasta"] },
  { name: "Narayanganj", location: { lat: 23.6238, lng: 90.5000 } },
  { name: "Keraniganj", location: { lat: 23.7000, lng: 90.3800 } },
];
