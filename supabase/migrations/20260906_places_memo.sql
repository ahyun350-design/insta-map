-- places.memo: 사용자 개인 메모 (이미 DB 적용됨 — 기록용)
alter table public.places add column if not exists memo text;
alter table public.places drop constraint if exists places_memo_len;
alter table public.places add constraint places_memo_len
  check (memo is null or char_length(memo) <= 200);
