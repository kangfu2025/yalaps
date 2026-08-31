/** แจ้งเตือนเมื่อยังไม่ได้สร้างตารางสินค้าในฐานข้อมูล */
export function ProductsSetupNotice() {
  return (
    <div className="pos-card">
      <div className="pos-card-title">⚠️ ยังไม่ได้ติดตั้งระบบขายสินค้าในฐานข้อมูล</div>
      <p className="small mb-2">
        ฟังก์ชันขายสินค้า/คลังสินค้าจะใช้งานได้หลังรันสคริปต์สร้างตารางเพียงครั้งเดียว:
      </p>
      <ol className="small mb-2 ps-3">
        <li>เปิด Supabase → SQL Editor</li>
        <li>
          คัดลอกเนื้อหาไฟล์ <code>supabase/products_migration.sql</code> ทั้งไฟล์ไปวาง
        </li>
        <li>กด Run แล้วรีเฟรชหน้านี้</li>
      </ol>
      <div className="small opacity-75">
        สคริปต์นี้รันซ้ำได้ ไม่กระทบตารางเดิม (เครื่อง PS5 / PC / ระบบล็อกหน้าจอ)
      </div>
    </div>
  );
}
