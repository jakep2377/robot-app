import React, { useState } from 'react';
import { View, Button } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polygon, LatLng } from 'react-native-maps';

function GoogleMapView() {
  const [drawingMode, setDrawingMode] = useState(false);
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(null);
  const [rectangleCoords, setRectangleCoords] = useState<LatLng[] | null>(null);

  // handle maps tabs
  const handleMapPress = (e: { nativeEvent: { coordinate: LatLng } }) => {
    if (!drawingMode) return;

    const { latitude, longitude } = e.nativeEvent.coordinate;

    // First tap -- fist corner
    if (!firstPoint) {
      setFirstPoint({ latitude, longitude });
      return;
    }

    // Second tap -- second corner
    const secondPoint = { latitude, longitude };

    const rect = [
      { latitude: firstPoint!.latitude, longitude: firstPoint!.longitude },
      { latitude: firstPoint!.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: firstPoint!.longitude },
    ];

    setRectangleCoords(rect);
    setDrawingMode(false);
    setFirstPoint(null);
  };

  return (
    // View of map and buttons
    <View style={{ flex: 1 }}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude: 41.0731,
          longitude: -81.5171,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        onPress={handleMapPress}
      >
        {/* DRAW RECTANGLE IF EXISTS */}
        {rectangleCoords && (
          <Polygon
            coordinates={rectangleCoords}
            strokeColor="blue"
            fillColor="rgba(0,0,255,0.3)"
            strokeWidth={2}
          />
        )}
      </MapView>

      {/* BUTTONS */}
      <View
        style={{
          position: 'absolute',
          bottom: 20,
          width: '100%',
          paddingHorizontal: 20,
        }}
      >
        <Button
          title={drawingMode ? 'Tap 2 points…' : 'Draw Area'}
          onPress={() => {
            setRectangleCoords(null);
            setDrawingMode(true);
          }}
        />

        <View style={{ marginTop: 10 }}>
          <Button
            title="Clear Area"
            onPress={() => {
              setRectangleCoords(null);
              setFirstPoint(null);
              setDrawingMode(false);
            }}
          />
        </View>
      </View>
    </View>
  );
}

export default GoogleMapView;
