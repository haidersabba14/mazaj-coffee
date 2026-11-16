# COFFEE ROYAL MANAGER

تطبيق SwiftUI أصلي مستقل للإدارة، بدون WebView. يعتمد على HTTPS API في https://mazaj-cafe-995.pages.dev وعلى نفس D1. الكود القديم في `ios/` محفوظ للرجوع إليه؛ البناء الجديد يستخدم `ios-manager/` فقط.

## البناء

على Mac مع Xcode وXcodeGen:

```sh
cd ios-manager
export APP_BUNDLE_ID=com.coffeeroyal.manager
xcodegen generate
open CoffeeRoyalManager.xcodeproj
```

ملف `project.yml` هو مصدر مشروع Xcode. ينشئ GitHub Actions مشروع `.xcodeproj` كاملًا ويرفقه في الإصدار مع ملفات Swift.

Workflow **Coffee Royal Manager IPA** يشغّل اختبارات الخادم والواجهة، ثم اختبارات iOS على Simulator، ثم يبني الجهاز وينشئ GitHub Release بملف IPA ونسخة Xcode وبيانات البناء. الوضع الافتراضي **غير موقّع** بناءً على طلب المالك. الملف غير قابل للتثبيت قبل إعادة توقيعه بالطريقة المناسبة. لا يُضمَّن رمز الإدارة أو أسرار Apple في IPA. صلاحية الجلسة ٨ ساعات ويمكن إلغاؤها.

دخول المالك: `owner` وكلمة المرور الحالية للمقهى. لا تضع كلمة المرور في الكود. الموظفون يدخلون باسم مستخدمهم وكلمة مرورهم؛ يضيفهم المالك من الإدارة. الجلسة تحفظ في Keychain للجهاز فقط، ويُقفل التطبيق في الخلفية، ويفتح بـ Face ID أو رمز الجهاز. إذا ألغيت الجلسة على الخادم يجب تسجيل الدخول من جديد.

## التوقيع الاختياري

الأسرار: `APPLE_CERTIFICATE_P12_B64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROFILE_B64`. المتغيرات: `ROYAL_BUNDLE_ID`, `APPLE_TEAM_ID`. لا ترسل المفاتيح في الدردشة. خيار signed يتحقق من مطابقة الفريق والحزمة وتاريخ profile ونوع التوزيع. التثبيت مقيّد بالأجهزة ونوع التوزيع في profile. لم تُشترَ عضوية أو خدمة توقيع.

## التنبيهات

داخل التطبيق: تحديث كل ٥ ثوانٍ أثناء فتحه وصوت قابل للتجربة والكتم وضبط المستوى. الصوت المحلي يحترم صامت iOS باستخدام AVAudioSession ambient. لا يُضمن عمل التحديث في الخلفية.

APNs: مسار تسجيل الجهاز ومعالج Swift ومُرسل JWT موجودون. لن يعمل APNs في IPA غير الموقّع؛ يلزم توقيع مع `aps-environment` وإعداد أسرار الخادم `APNS_KEY`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APNS_TOPIC`. يختار `APNS_SANDBOX=true` بيئة التطوير عند الحاجة. يضيف Workflow entitlement فقط إذا منحه profile. لم يُختبر تسليم APNs على iPhone فعلي دون هذه المتطلبات.

Push الزبون هو Web Push منفصل ويعمل على الويب المثبت حين يدعمه النظام، ولا يتطلب IPA أو شهادة Apple Developer من المقهى.
