import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
// @ts-ignore
import logoImg from "../assets/images/al_eman_logo_new_1779919375634.png";

interface SalatMessageProps {
  plain?: boolean;
}

const SalatMessage = ({ plain = false }: SalatMessageProps) => {
  const [processedLogo, setProcessedLogo] = useState<string | null>(null);

  useEffect(() => {
    const processImage = () => {
      const img = new Image();
      img.src = logoImg;
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          if (r > 245 && g > 245 && b > 245) {
            data[i+3] = 0;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        setProcessedLogo(canvas.toDataURL());
      };
    };
    processImage();
  }, []);

  const innerContent = (
    <div className="flex flex-col items-center justify-center py-2 px-6 text-center space-y-5 sm:space-y-8 animate-fadeIn overflow-visible w-full h-full flex-1">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative"
      >
        <motion.div 
          animate={{ 
            y: [0, -4, 0],
          }}
          transition={{ 
            duration: 4, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className="relative bg-transparent p-0 w-32 h-24 sm:w-44 sm:h-30 md:w-52 md:h-36 flex items-center justify-center transform hover:scale-105 pointer-events-none"
        >
           {processedLogo ? (
             <img 
               src={processedLogo} 
               alt="Al Eman Logo" 
               className="w-full h-full object-contain border-0 m-0 p-0 animate-fadeIn"
               referrerPolicy="no-referrer"
             />
           ) : (
             <div className="w-full h-full flex items-center justify-center">
               <div className="w-6 h-6 border-2 border-emerald-100 border-t-emerald-500 rounded-full animate-spin"></div>
             </div>
           )}
        </motion.div>
      </motion.div>
      
      <motion.div 
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="space-y-4 sm:space-y-7 md:space-y-9 relative w-full"
      >
        <div className="flex flex-col items-center">
          <h2 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter bg-gradient-to-br from-emerald-500 via-emerald-800 to-teal-950 bg-clip-text text-transparent drop-shadow-[0_10px_30px_rgba(16,185,129,0.15)] pt-1 pb-2 select-none leading-tight whitespace-nowrap drop-shadow-sm">
            صلي على النبي
          </h2>
        </div>
        
        <div className="flex items-center justify-center gap-4 pt-0">
          <p className="text-[14px] sm:text-[22px] md:text-[26px] font-black text-emerald-950/35 uppercase tracking-[0.3em] leading-relaxed italic select-none whitespace-nowrap">
            صلى الله عليه وسلم
          </p>
        </div>
      </motion.div>
    </div>
  );

  if (plain) {
    return innerContent;
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-4 flex flex-col items-center justify-center text-center animate-fadeIn relative my-1 shrink-0" dir="rtl">
      {innerContent}
    </div>
  );
};

export default SalatMessage;
