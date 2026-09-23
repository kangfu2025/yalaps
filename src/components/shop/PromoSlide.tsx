import { useState } from "react";
import { youtubeEmbedUrl, type PromoMedia } from "@/lib/promoMedia";

/**
 * สไลด์หนึ่งรายการบนจอลูกค้า — รูป / คลิป YouTube / วิดีโอที่อัปโหลด
 *
 * ทั้งก้อนนี้ถูก unmount ทันทีที่มีบิลหรือ QR ขึ้นจอ (โครงเดิมของ display.tsx
 * return คนละสาขาอยู่แล้ว) วิดีโอจึงหยุดเองไม่เล่นค้างอยู่เบื้องหลัง
 */
export function PromoSlide({
  item,
  only,
  onEnded,
}: {
  item: PromoMedia;
  /** มีรายการเดียวในคิว — วิดีโอให้วนซ้ำเองไปเรื่อย ๆ ไม่ต้องสลับ */
  only: boolean;
  onEnded: () => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="display-promo-empty">
        <div className="brand-big">🎮 YALA PLAYSTATION</div>
        <div className="sub">ยินดีต้อนรับ</div>
        <div className="hint">โหลดสื่อไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต</div>
      </div>
    );
  }

  if (item.kind === "youtube" && item.youtube_id) {
    return (
      <div className={`display-media display-media-yt is-${item.fit}`}>
        <iframe
          src={youtubeEmbedUrl(item.youtube_id)}
          title={item.name || "วิดีโอโปรโมชั่น"}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          frameBorder="0"
        />
      </div>
    );
  }

  if (item.kind === "video" && item.video_url) {
    return (
      <div className={`display-media is-${item.fit}`}>
        <video
          src={item.video_url}
          autoPlay
          muted
          playsInline
          // มีคลิปเดียวก็วนเอง ถ้ามีหลายรายการให้เล่นจบแล้วสลับ
          loop={only}
          onEnded={only ? undefined : onEnded}
          onError={() => setFailed(true)}
          // ไฟล์บางไฟล์มีแทร็กซับไตเติ้ลฝังมาด้วย ปิดทุกแทร็กทิ้งตอนโหลดเสร็จ
          onLoadedMetadata={(e) => {
            const tracks = e.currentTarget.textTracks;
            for (let i = 0; i < tracks.length; i++) tracks[i].mode = "disabled";
          }}
        />
      </div>
    );
  }

  if (item.data_url) {
    return (
      <img
        src={item.data_url}
        alt={item.name || "Promotion"}
        className={`display-promo-img is-${item.fit}`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="display-promo-empty">
      <div className="brand-big">🎮 YALA PLAYSTATION</div>
      <div className="sub">ยินดีต้อนรับ</div>
    </div>
  );
}
