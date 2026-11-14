# Valetudo

Cette intégration ajoute à Gladys les robots aspirateurs qui tournent sous
[Valetudo](https://valetudo.cloud/). Tout reste sur votre réseau local : le
robot et Gladys communiquent par votre broker MQTT, sans cloud.

Tous les robots pris en charge par Valetudo fonctionnent : l'intégration lit
ce que chaque robot annonce sur le broker, sans liste de modèles.

## Ce que vous obtenez

Un appareil par robot, avec :

- **État** : nettoyage, pause, retour à la base, sur la base, arrêté, erreur.
- **Mode** : lancer un nettoyage, ou l'arrêter.
- Boutons **Pause** et **Retour à la base**.
- **Localiser** : le robot émet un son (robots qui le permettent).
- Niveau de **batterie**.
- Puissance d'**aspiration**, et réglages **Eau** et **Mode** quand le robot
  en dispose.
- **Consommables** : durée de vie restante des brosses, du filtre et des
  capteurs, en pourcentage ou en minutes selon le robot.

## Avant de commencer

Il vous faut un broker MQTT joignable par le robot et par Gladys (Mosquitto,
ou celui de Home Assistant).

Dans l'interface web de Valetudo, ouvrez **Connectivité → MQTT**, puis :

1. Activez **MQTT** et renseignez l'adresse de votre broker (et ses
   identifiants).
2. Activez l'**autodécouverte Home Assistant**. Home Assistant lui-même n'est
   pas nécessaire : l'intégration lit seulement ce format d'annonce.
3. Enregistrez.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez l'**adresse du broker**, par exemple
   `mqtt://192.168.1.10:1883`, puis le nom d'utilisateur et le mot de passe
   si votre broker en demande.
3. Enregistrez. Le statut passe à connecté, et vos robots apparaissent dans
   l'onglet **Découverte**, prêts à être ajoutés.

## Dépannage

- **Broker injoignable ou identifiants refusés** : vérifiez l'adresse, le
  port et les identifiants. Gladys doit pouvoir joindre le broker sur votre
  réseau (pare-feu, VLAN).
- **Connecté, mais aucun robot dans Découverte** : vérifiez que
  l'autodécouverte Home Assistant est activée dans Valetudo, et que le
  préfixe de découverte est le même des deux côtés (`homeassistant` par
  défaut).
- **Le robot apparaît injoignable** : Valetudo a perdu sa connexion au broker
  (robot éteint, hors de portée du Wi-Fi, MQTT désactivé). Les commandes sont
  refusées jusqu'à son retour.
- **Une commande manque** : un robot n'expose que ce qu'il sait faire. Un
  robot sans serpillière n'a pas de réglage d'eau, par exemple.

## Pas encore pris en charge

La carte, le nettoyage par pièce ou par zone, les commandes de la station et
les statistiques ne sont pas disponibles dans cette version.
