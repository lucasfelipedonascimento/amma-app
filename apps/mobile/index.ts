// A tarefa de localização precisa ser registrada antes de qualquer tela (o sistema pode acordá-la com o app fechado).
import './src/driver/backgroundLocation';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
