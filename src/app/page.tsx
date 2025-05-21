
import { redirect } from 'next/navigation';

export default function WelcomePage() {
  // Leitet direkt zur neu gestalteten Admin-Login-Seite weiter
  redirect('/admin/login');
  // Es ist nicht notwendig, hier etwas zu rendern, da redirect() den Prozess unterbricht.
  // return null; 
}
