# مصادر الصور

جميع الصور محلية بصيغة WebP؛ تم فحصها بصريًا. الشعار SVG أصلي وتوجد نسخ PNG لتثبيت PWA.

## صور أصلية مولّدة للمشروع

- cappuccino.webp: كابتشينو برغوة ورسمة قلب، تصوير واقعي مولّد خصيصًا.
- americano.webp: أمريكانو ساخن أسود ببخار، تصوير واقعي مولّد خصيصًا.
- iced-americano.webp: أمريكانو أسود بارد في كأس شفاف مع ثلج، تصوير واقعي مولّد خصيصًا.
- hot-milk.webp: حليب ساخن ببخار، تصوير واقعي مولّد خصيصًا.

تم توليد الصور باستخدام أداة إنشاء الصور في هذه الجلسة؛ ليست صورًا لمشروبات المقهى الفعلية. حُفظت النسخ الأصلية في مجلد generated_images بالجلسة، ونسخ WebP ضمن المشروع.

## صور مخزون مرخّص

ترخيص Unsplash: https://unsplash.com/license

- hero.webp: https://images.unsplash.com/photo-1442512595331-e89e73853f31 — تحضير القهوة.
- story.webp: https://images.unsplash.com/photo-1447933601403-0c6688de566e — حبوب القهوة.
- black.webp: https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd — كوب قهوة سوداء.
- secret.webp: https://images.unsplash.com/photo-1461023058943-07fcbe16d735 — قهوة مميزة بطبقات.

ترخيص Pexels: https://www.pexels.com/license/

- cold-milk.webp: https://www.pexels.com/photo/248412/ — كأس حليب مع زجاجة وإبريق.

يمكن تغيير الصور بروابط HTTPS من لوحة الإدارة أو استبدال ملفات public/images في Git. سكربت scripts/assets.mjs ينزّل صور المخزون الأولية فقط؛ لا تشغّله فوق النسخة النهائية لأنه لا يعيد توليد الصور الأصلية.
