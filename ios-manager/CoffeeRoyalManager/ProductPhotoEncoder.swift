import UIKit

enum ProductPhotoEncoder {
    static func encode(_ image:UIImage,maxBytes:Int=200*1024)->Data? {
        guard image.size.width>0,image.size.height>0 else{return nil}
        for dimension:CGFloat in [1000,800,600] {
            let ratio=min(1,dimension/max(image.size.width,image.size.height))
            let size=CGSize(width:image.size.width*ratio,height:image.size.height*ratio)
            let format=UIGraphicsImageRendererFormat();format.scale=1;format.opaque=true
            let resized=UIGraphicsImageRenderer(size:size,format:format).image{context in
                UIColor.white.setFill();context.fill(CGRect(origin:.zero,size:size));image.draw(in:CGRect(origin:.zero,size:size))
            }
            for quality:CGFloat in [0.8,0.65,0.45,0.3] {
                if let data=resized.jpegData(compressionQuality:quality),data.count<=maxBytes{return data}
            }
        }
        return nil
    }
}
