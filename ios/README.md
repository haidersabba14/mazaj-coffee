# تطبيق مزاج للإدارة — iPhone وiPad

مشروع SwiftUI + WKWebView يستعمل نفس لوحة إدارة الموقع، فلا توجد قاعدة منفصلة ولا مفاتيح API مضمّنة. أدخل رابط المقهى HTTPS أول مرة، ثم سجّل الدخول بكلمة مرور الإدارة. يظهر الطلب **بانتظار القبول**؛ اضغط قبول لتجهيزه أو رفض لإلغائه.

التنبيهات **داخل التطبيق أثناء فتحه فقط** مع تحديث لوحة الطلبات كل ٣٠ ثانية. لا توجد خدمة APNs أو إشعارات خلفية في هذه النسخة. عند انتقال iOS للخلفية لا نعد باستمرار التحديث. الموقع يبقى PWA بديلًا مجانيًا يعمل دون IPA.

## البناء من GitHub

يوجد Workflow يدوي باسم **Build signed iPhone IPA** في `.github/workflows/ios.yml`. لم يُشغّل، ولم تُبنَ IPA أو تُختبر SwiftUI على Xcode في بيئة Linux هذه. يلزم رفع المصدر إلى مستودع GitHub قابل للكتابة أولًا.

لإخراج IPA قابلة للتثبيت على أجهزة مسجّلة:

1. يلزم Apple Developer مع شهادة **Apple Distribution** بصيغة P12 ومفتاحها الخاص، وملف **Ad Hoc provisioning profile** يطابق Bundle ID ويضم UDID للأجهزة التي ستثبت التطبيق. العضوية عادة مدفوعة؛ لم نفعّلها أو نوافق على شرائها. دونها استخدم PWA مجانًا، أو Xcode على Mac للتثبيت الشخصي بحساب Apple مجاني ضمن قيوده، وليس هذا Workflow التوزيع.
2. في GitHub Settings → Secrets and variables → Actions أضف Variables: `APP_BUNDLE_ID` (مثل `com.yourname.mazajadmin`) و`APPLE_TEAM_ID`.
3. أضف Secrets: `APPLE_CERTIFICATE_P12_B64` (الشهادة P12 بترميز Base64)، و`APPLE_CERTIFICATE_PASSWORD`، و`APPLE_PROFILE_B64` (ملف mobileprovision بترميز Base64). أدخلها مباشرة في GitHub، ولا ترسلها في الدردشة ولا ترفعها كملفات إلى المستودع.
4. راجع حصة GitHub Actions المجانية لحسابك قبل التشغيل. macOS يستهلك حصة أكبر من Linux؛ Workflow يدوي ولا يبدأ على كل push. لا تفعّل تجاوزات مدفوعة.
5. Actions → Build signed iPhone IPA → Run workflow. بعد نجاحه تُنزّل `MazajAdmin-IPA` من Artifacts خلال ٣ أيام. التوقيع Ad Hoc يعمل فقط على الأجهزة المدرجة في profile، وليس على كل أجهزة العالم. لا يتم النشر على App Store أو TestFlight تلقائيًا.
6. ثبّت على الجهاز المسجّل بأدوات Apple المناسبة مثل Apple Configurator أو Xcode، ثم أدخل رابط Worker المنشور. غيّر الإعداد من ترس التطبيق عند تغيير الرابط. عنوان الاتصال ليس سرًا؛ لا تضع كلمة مرور ضمن الرابط.

## على Mac محلي

ثبّت Xcode وXcodeGen، ثم:

```sh
cd ios
export APP_BUNDLE_ID=com.yourname.mazajadmin
xcodegen generate
open MazajAdmin.xcodeproj
```

اختر فريقك والتوقيع المناسب داخل Xcode، وابنِ على جهازك. للتوزيع استخدم Product → Archive ثم Distribute App مع profile الصحيح. إصدار Xcode قد يحتاج تعديل نوع التصدير `release-testing` إذا تغيّرت تسمية خيارات Apple.

لا تُرفع الشهادة أو ملف provisioning أو IPA الموقّعة إلى ملفات Git. لا تتضمن النسخة رموز Apple/APNs. الربط الحالي محصور في HTTPS ونطاق المقهى الذي تحفظه؛ أضف فقط نطاقًا تملكه وتثق به.
