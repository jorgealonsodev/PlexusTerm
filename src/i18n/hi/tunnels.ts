import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "लोकल (-L)",
    remote: "रिमोट (-R)",
    dynamic: "डायनेमिक SOCKS5 (-D)",
  },
  panel: {
    title: "SSH टनल",
    new: "नया",
    startAll: "सभी शुरू करें",
    stopAll: "सभी रोकें",
    readError: "सहेजे गए टनल पढ़े नहीं जा सके: {message}। फ़ाइल की सुरक्षा के लिए संपादन अक्षम है।",
    saveError: "टनल सहेजे नहीं जा सके: {error}",
    empty: "अभी तक कोई टनल नहीं।",
    missingSession: "सेशन नहीं मिला",
    via: "{session} के माध्यम से {tunnel}",
    hint: "जब तक आप कोई दूसरा पता न चुनें, टनल 127.0.0.1 पर सुनते हैं।",
  },
  state: {
    stopped: "रुका हुआ",
    starting: "शुरू हो रहा है…",
    running: "चल रहा है",
    error: "त्रुटि",
  },
  edit: {
    newTitle: "नया SSH टनल",
    editTitle: "टनल संपादित करें",
    namePlaceholder: "पोर्ट से बनाया गया",
    type: "प्रकार",
    sshSession: "SSH सेशन",
    chooseSession: "एक सहेजा गया सेशन चुनें…",
    noSessions: "पहले एक SSH सेशन सहेजें; टनल उसके कनेक्शन का उपयोग करते हैं।",
    listenAddressServer: "सर्वर पर सुनने का पता",
    listenAddress: "सुनने का पता",
    exposedRemote: "{host} पर सुनने से अन्य मशीनें सर्वर पोर्ट तक पहुँच सकती हैं। इसे निजी रखने के लिए 127.0.0.1 का उपयोग करें।",
    exposedLocal: "{host} पर सुनने से अन्य मशीनें इस टनल का उपयोग कर सकती हैं। इसे निजी रखने के लिए 127.0.0.1 का उपयोग करें।",
    destinationFromHere: "गंतव्य (इस मशीन से)",
    destinationFromServer: "गंतव्य (सर्वर से)",
    dynamicHint: "एप्लिकेशन इस पोर्ट को SOCKS5 प्रॉक्सी के रूप में उपयोग करते हैं; कनेक्शन सर्वर खोलता है।",
  },
  form: {
    chooseSession: "एक सहेजा गया SSH सेशन चुनें",
    invalidListenPort: "सुनने का पोर्ट 1 और 65535 के बीच की संख्या होना चाहिए",
    destHostRequired: "गंतव्य होस्ट आवश्यक है",
    invalidDestPort: "गंतव्य पोर्ट 1 और 65535 के बीच की संख्या होना चाहिए",
  },
  file: {
    invalidJson: "टनल फ़ाइल मान्य JSON नहीं है: {error}",
    unsupportedVersion: "असमर्थित टनल फ़ाइल संस्करण",
    invalidTunnels: "टनल फ़ाइल में अमान्य टनल हैं",
  },
  launcher: {
    sessionGone: "इसका सहेजा गया सेशन अब मौजूद नहीं है; कोई दूसरा चुनने के लिए टनल संपादित करें।",
    startFailed: "टनल शुरू नहीं हो सका: {error}",
  },
};
