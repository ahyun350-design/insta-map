/**
 * Single source: map category → OMT class/subclass + sangga 업종 keywords.
 * Icon exprs, zoom filters, and sangga builders should stay aligned with this table.
 */

export type PoiMapCategoryId =
  | "restaurant"
  | "fast_food"
  | "cafe"
  | "bakery"
  | "bar"
  | "convenience"
  | "grocery"
  | "shop"
  | "lodging"
  | "hospital"
  | "pharmacy"
  | "bank"
  | "beauty"
  | "school"
  | "park"
  | "landmark"
  | "town_hall"
  | "police"
  | "post"
  | "fuel"
  | "parking"
  | "subway";

/** Badge + label colors (paper). Glyph detail strokes use `icon`. */
export const POI_MAP_COLORS: Record<
  PoiMapCategoryId,
  { icon: string; text: string }
> = {
  restaurant: { icon: "#EE7A2B", text: "#A84A0C" },
  fast_food: { icon: "#E2562B", text: "#A3330F" },
  cafe: { icon: "#8B5A3C", text: "#6A3D22" },
  bakery: { icon: "#C9932E", text: "#875E10" },
  bar: { icon: "#7A4FC6", text: "#56309C" },
  convenience: { icon: "#1FA058", text: "#127340" },
  grocery: { icon: "#13997F", text: "#0B6E5A" },
  shop: { icon: "#DB5389", text: "#A22A5D" },
  lodging: { icon: "#3F73D6", text: "#234FA3" },
  hospital: { icon: "#DC4040", text: "#A41F1F" },
  pharmacy: { icon: "#159C9C", text: "#0C6F6F" },
  bank: { icon: "#4E5FB8", text: "#33418C" },
  beauty: { icon: "#B55BA8", text: "#86367C" },
  school: { icon: "#3A70B8", text: "#234F8A" },
  park: { icon: "#3E9A52", text: "#286E39" },
  landmark: { icon: "#4B5563", text: "#1F2937" },
  town_hall: { icon: "#56657D", text: "#36445A" },
  police: { icon: "#2F4E92", text: "#1D3468" },
  post: { icon: "#D9543A", text: "#9E3420" },
  fuel: { icon: "#64727F", text: "#3E4A55" },
  parking: { icon: "#2F7DE1", text: "#1B57A6" },
  subway: { icon: "#5A6A7A", text: "#1E2124" },
};

/**
 * Sangga 중/소분류 keyword → category (checked in order within 대분류 handlers).
 * Used by audit scripts; build-korea-sangga.py should mirror these buckets.
 */
export const SANGGA_CATEGORY_KEYWORDS: Record<
  PoiMapCategoryId,
  { jung?: string[]; so?: string[]; dae?: string[] }
> = {
  restaurant: {
    dae: ["음식"],
    jung: [
      "한식",
      "중식",
      "일식",
      "서양식",
      "동남아시아",
      "기타 외국",
      "구내식당·뷔페",
    ],
  },
  fast_food: {
    dae: ["음식"],
    jung: ["기타 간이"],
    so: ["치킨", "햄버거", "피자", "샌드위치", "도시락", "김밥"],
  },
  cafe: {
    dae: ["음식"],
    jung: ["비알코올"],
    so: ["카페", "커피", "찻집", "주스", "생과일"],
  },
  bakery: {
    dae: ["음식"],
    so: ["빵", "도넛", "떡", "한과", "베이글", "제과", "아이스크림", "빙수"],
  },
  bar: {
    dae: ["음식"],
    jung: ["주점"],
    so: ["호프", "맥주", "이자카야", "와인", "칵테일", "포차", "술"],
  },
  convenience: {
    dae: ["소매"],
    so: ["편의점"],
  },
  grocery: {
    dae: ["소매"],
    jung: ["종합 소매", "식료품 소매"],
    so: ["슈퍼", "마트", "시장", "반찬"],
  },
  shop: {
    dae: ["소매"],
    jung: [
      "섬유·의복·신발 소매",
      "의약·화장품 소매",
      "오락용품 소매",
      "장식품 소매",
      "시계·귀금속 소매",
    ],
    so: ["의류", "잡화", "화장품", "서적", "문구", "꽃", "신발"],
  },
  lodging: { dae: ["숙박"] },
  hospital: {
    dae: ["보건의료"],
    jung: ["병원", "의원"],
    so: ["치과", "한의원", "병원", "의원"],
  },
  pharmacy: {
    dae: ["보건의료", "소매"],
    so: ["약국"],
  },
  bank: {
    so: ["은행", "ATM", "금융"],
  },
  beauty: {
    dae: ["수리·개인"],
    jung: ["이용·미용"],
    so: ["미용", "바버", "네일", "피부"],
  },
  school: {
    so: ["학교", "유치원", "초등학교", "중학교", "고등학교", "대학교"],
  },
  park: { so: ["공원", "놀이터"] },
  landmark: { so: ["명소", "관광", "문화재"] },
  town_hall: {
    so: ["주민센터", "구청", "시청", "도서관", "행정"],
  },
  police: { so: ["경찰", "파출소", "지구대"] },
  post: { so: ["우체국", "우편"] },
  fuel: { so: ["주유", "LPG", "충전소"] },
  parking: { so: ["주차장", "주차"] },
  subway: { so: ["지하철", "전철", "역"] },
};

/** OMT class/subclass literals that resolve to each category (for filters + docs). */
export const OMT_CLASS_TO_CATEGORY: Array<{
  category: PoiMapCategoryId;
  classes?: string[];
  subclasses?: string[];
}> = [
  { category: "cafe", classes: ["cafe"], subclasses: ["coffee"] },
  { category: "restaurant", classes: ["restaurant"] },
  {
    category: "fast_food",
    classes: ["fast_food"],
    subclasses: ["chicken", "burger", "pizza", "sandwich"],
  },
  { category: "bakery", classes: ["bakery", "ice_cream", "pastry", "confectionery"] },
  { category: "bar", classes: ["bar", "beer", "alcohol", "wine", "pub"] },
  { category: "convenience", subclasses: ["convenience"] },
  {
    category: "grocery",
    classes: ["grocery"],
    subclasses: ["supermarket", "marketplace"],
  },
  {
    category: "shop",
    classes: [
      "shop",
      "mall",
      "department_store",
      "clothes",
      "shoes",
      "florist",
      "books",
      "gift",
      "jewelry",
      "cosmetics",
      "perfumery",
      "stationery",
    ],
  },
  { category: "lodging", classes: ["lodging", "hotel"] },
  {
    category: "hospital",
    classes: ["hospital", "doctors", "clinic", "dentist"],
  },
  { category: "pharmacy", classes: ["pharmacy"] },
  { category: "bank", classes: ["bank", "atm"] },
  {
    category: "beauty",
    classes: ["hairdresser", "beauty"],
    subclasses: ["hairdresser", "beauty"],
  },
  {
    category: "school",
    classes: ["school", "college", "kindergarten", "university"],
  },
  { category: "park", classes: ["park", "playground"] },
  {
    category: "landmark",
    classes: ["attraction", "museum", "gallery", "zoo", "theme_park"],
  },
  {
    category: "town_hall",
    classes: ["town_hall", "community_centre", "library", "courthouse"],
  },
  { category: "police", classes: ["police"] },
  { category: "post", classes: ["post"], subclasses: ["post_office"] },
  { category: "fuel", classes: ["fuel"] },
  { category: "parking", classes: ["parking"] },
  { category: "subway", classes: ["railway", "rail", "subway", "station"] },
];

export const ALL_POI_MAP_CATEGORY_IDS: PoiMapCategoryId[] = [
  "restaurant",
  "fast_food",
  "cafe",
  "bakery",
  "bar",
  "convenience",
  "grocery",
  "shop",
  "lodging",
  "hospital",
  "pharmacy",
  "bank",
  "beauty",
  "school",
  "park",
  "landmark",
  "town_hall",
  "police",
  "post",
  "fuel",
  "parking",
  "subway",
];
