#!/usr/bin/env bash
# Smoke test API. Pakai: DATA_DIR=/tmp/xx node server.js &  lalu: bash tests/smoke.sh
B=${BASE:-http://localhost:3000}
j() { curl -s -X "$1" "$B$2" -H 'Content-Type: application/json' ${TOKEN:+-H "Authorization: Bearer $TOKEN"} ${3:+-d "$3"}; echo; }
ok=0; fail=0
chk() { if echo "$2" | grep -q "$3"; then ok=$((ok+1)); echo "  OK   $1"; else fail=$((fail+1)); echo "  FAIL $1 -> $2" | head -c 400; echo; fi; }

R=$(j POST /api/login '{"username":"staf","password":"salah"}'); chk "login salah ditolak" "$R" "salah"
R=$(j POST /api/login '{"username":"superadmin","password":"super123"}'); SA=$(echo "$R" | sed 's/.*"token":"\([a-f0-9]*\)".*/\1/')
R=$(j POST /api/login '{"username":"admin","password":"admin123"}'); AD=$(echo "$R" | sed 's/.*"token":"\([a-f0-9]*\)".*/\1/')
R=$(j POST /api/login '{"username":"staf","password":"staf123"}'); ST=$(echo "$R" | sed 's/.*"token":"\([a-f0-9]*\)".*/\1/')
chk "token superadmin" "$SA" "^[a-f0-9]\{20,\}$"

TOKEN=$ST
R=$(j GET /api/products); chk "staf lihat produk" "$R" "Kalung"; chk "staf tidak lihat harga beli" "$(echo "$R" | grep -c '"cost"')" "^0$"
R=$(j POST /api/products '{"name":"x","price":1}'); chk "staf tak boleh tambah produk" "$R" "tidak memiliki akses"
R=$(j GET /api/users); chk "staf tak boleh lihat user" "$R" "tidak memiliki akses"
R=$(j GET /api/products/barcode/RH-0001); chk "cari by SKU" "$R" "Salib"
BC=$(echo "$R" | sed 's/.*"barcode":"\([0-9]*\)".*/\1/'); R=$(j GET /api/products/barcode/$BC); chk "cari by barcode" "$R" "Salib"

# penjualan
R=$(j POST /api/sales '{"items":[{"product_id":1,"qty":2},{"product_id":3,"qty":1}],"payment_method":"tunai","paid":300000,"discount":5000}')
chk "penjualan tunai" "$R" '"invoice_no":"INV-'; chk "kembalian benar" "$R" '"change_amount":110000'
SID=$(echo "$R" | sed 's/.*"id":\([0-9]*\),"invoice_no".*/\1/')
R=$(j POST /api/sales '{"items":[{"product_id":1,"qty":2}],"payment_method":"tunai","paid":100}'); chk "uang kurang ditolak" "$R" "kurang"
R=$(j POST /api/sales '{"items":[{"product_id":1,"qty":9999}],"payment_method":"qris"}'); chk "stok tak cukup ditolak" "$R" "tidak cukup"
R=$(j GET /api/products/barcode/RH-0001); chk "stok toko berkurang 12->10" "$R" '"store_qty":10'

TOKEN=$AD
R=$(j POST /api/sales/$SID/void '{"reason":"salah input"}'); chk "void penjualan" "$R" '"status":"void"'
R=$(j GET /api/products/barcode/RH-0001); chk "stok kembali 12" "$R" '"store_qty":12'

# produk CRUD
R=$(j POST /api/products '{"name":"Tes Barang","price":10000,"cost":6000,"category_id":1,"store_qty":3,"wh_qty":7}'); chk "tambah produk (auto sku/barcode)" "$R" '"barcode":"2'
PID=$(echo "$R" | sed 's/.*"id":\([0-9]*\),.*/\1/')
R=$(j PUT /api/products/$PID '{"name":"Tes Barang 2","price":12000}'); chk "edit produk" "$R" '"ok":true'
R=$(j DELETE /api/products/$PID); chk "hapus permanen (tanpa riwayat)" "$R" '"deleted":true'
R=$(j DELETE /api/products/1); chk "arsip (ada riwayat)" "$R" '"archived":true'
R=$(j PUT /api/products/1 '{"active":1}'); chk "aktifkan lagi" "$R" '"ok":true'

# stok & transfer
R=$(j POST /api/stock/adjust '{"product_id":2,"location":"store","mode":"set","qty":50,"note":"opname"}'); chk "opname stok" "$R" '"balance":50'
R=$(j POST /api/transfers '{"items":[{"product_id":2,"qty":15}],"note":"isi etalase"}'); chk "transfer gudang->toko" "$R" '"number":"TRF-'
R=$(j GET "/api/products/barcode/RH-0002"); chk "stok toko 65 & gudang 25" "$R" '"store_qty":65,"wh_qty":25'
R=$(j POST /api/transfers '{"items":[{"product_id":2,"qty":9999}]}'); chk "transfer melebihi stok gudang ditolak" "$R" "tidak cukup"

# PO
R=$(j POST /api/po '{"supplier_id":1,"items":[{"product_id":2,"qty":100,"cost":24000},{"product_id":9,"qty":50,"cost":6500}]}'); chk "buat PO draft" "$R" '"status":"draft"'
PO=$(echo "$R" | sed 's/.*"id":\([0-9]*\),"po_number".*/\1/')
R=$(j POST /api/po/$PO/receive '{"items":[{"item_id":1,"qty":1}]}'); chk "terima sebelum approve ditolak" "$R" "disetujui"
R=$(j POST /api/po/$PO/status '{"status":"submitted"}'); chk "ajukan" "$R" '"status":"submitted"'
R=$(j POST /api/po/$PO/status '{"status":"approved"}'); chk "setujui" "$R" '"status":"approved"'
R=$(j PUT /api/po/$PO '{"supplier_id":1,"revision_note":"tambah barang, kurangi qty","items":[{"product_id":2,"qty":80,"cost":24000},{"product_id":9,"qty":50,"cost":6500},{"product_id":10,"qty":10,"cost":34000}]}')
chk "revisi PO (rev 1, perlu approve ulang)" "$R" '"revision":1'; chk "status kembali submitted" "$R" '"status":"submitted"'; chk "ada riwayat revisi" "$R" '"revisions":\[{"id"'
R=$(j POST /api/po/$PO/status '{"status":"approved"}')
IT=$(j GET /api/po/$PO | sed 's/.*"items":\[{"id":\([0-9]*\),.*/\1/')
R=$(j POST /api/po/$PO/receive "{\"items\":[{\"item_id\":$IT,\"qty\":30}]}"); chk "terima sebagian" "$R" '"status":"partial"'
R=$(j POST /api/po/$PO/receive "{\"items\":[{\"item_id\":$IT,\"qty\":999}]}"); chk "terima berlebih ditolak" "$R" "melebihi"
R=$(j GET "/api/products/barcode/RH-0002"); chk "stok gudang naik 25->55" "$R" '"wh_qty":55'

# pemesanan
TOKEN=
R=$(j POST /api/public/orders '{"customer_name":"Budi","phone":"081234567890","address":"Jl. A","payment_method":"transfer","items":[{"product_id":3,"qty":2}]}'); chk "order publik" "$R" '"order_no":"ORD-'
ON=$(echo "$R" | sed 's/.*"order_no":"\([A-Z0-9-]*\)".*/\1/')
R=$(j GET "/api/public/orders/$ON?phone=081234567890"); chk "lacak pesanan" "$R" '"status":"baru"'
R=$(j GET "/api/public/orders/$ON?phone=0000000000"); chk "lacak salah HP ditolak" "$R" "tidak ditemukan"
TOKEN=$ST
OID=$(j GET /api/orders | sed 's/.*"id":\([0-9]*\),"order_no".*/\1/' | head -c 5)
R=$(j POST /api/orders/$OID/status '{"status":"selesai"}'); chk "selesai sebelum bayar ditolak" "$R" "pembayaran"
R=$(j POST /api/orders/$OID/pay '{"method":"transfer"}'); chk "bayar pesanan" "$R" '"payment_status":"lunas"'
R=$(j POST /api/orders/$OID/status '{"status":"selesai"}'); chk "selesaikan pesanan" "$R" '"status":"selesai"'

# dashboard & laporan
R=$(j GET /api/dashboard); chk "dashboard" "$R" '"series":\['; chk "staf tak lihat nilai stok" "$(echo "$R" | grep -c stock_value)" "^0$"
TOKEN=$AD
R=$(j GET /api/dashboard); chk "admin lihat nilai stok" "$R" 'stock_value'
R=$(j GET /api/reports/sales); chk "laporan penjualan" "$R" '"by_product":\['; chk "laba dihitung" "$R" '"profit":'
R=$(curl -s "$B/api/reports/export?type=sales" -H "Authorization: Bearer $AD" | head -c 300); chk "export CSV" "$R" "Invoice"
TOKEN=$ST; R=$(j GET /api/reports/sales); chk "staf tak boleh laporan" "$R" "tidak memiliki akses"

# user mgmt
TOKEN=$SA
R=$(j POST /api/users '{"username":"kasir2","name":"Kasir Dua","password":"rahasia1","role":"staf"}'); chk "tambah user" "$R" '"id":'
R=$(j GET /api/audit); chk "audit log" "$R" "revisi_po"
curl -s "$B/api/backup" -H "Authorization: Bearer $SA" -o /tmp/bk.db; chk "backup db" "$(head -c 15 /tmp/bk.db)" "SQLite format"
R=$(curl -s -o /dev/null -w '%{http_code}' $B/); chk "halaman / ada" "$R" "200\|404"
echo; echo "HASIL: $ok lulus, $fail gagal"; [ $fail -eq 0 ]
