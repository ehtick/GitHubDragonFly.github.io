import {
	Color,
	BufferAttribute,
	DefaultLoadingManager,
	DoubleSide,
	InterleavedBufferAttribute,
	Matrix4,
	MeshBasicMaterial
} from "three";

import { deinterleaveAttribute } from "three/addons/utils/BufferGeometryUtils.min.js";

async function import_decompress() {

	try {

		const { WebGLRenderer } = await import( "three" );
		const { decompress } = await import(
			"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/utils/TextureUtils.min.js"
		);

		const renderer = new WebGLRenderer( { antialias: true } );

		return { decompress, renderer };

	} catch ( error ) { /* just continue */ }

	try {

		const { CanvasTexture, NodeMaterial, QuadMesh, WebGPURenderer } = await import( "three" );
		const { texture, uv } = await import( "three/tsl" );

		const renderer = new WebGPURenderer( { antialias: true } );
		await renderer.init();

		/* Modified decompress function from TextureUtilsGPU.js file (non-async) */

		const _quadMesh = /*@__PURE__*/ new QuadMesh();

		function decompress( blitTexture, maxTextureSize = Infinity, renderer = null ) {

			const blitTexture_clone = blitTexture.clone();

			blitTexture_clone.offset.set( 0, 0 );
			blitTexture_clone.repeat.set( 1, 1 );

			const material = new NodeMaterial();
			material.fragmentNode = texture( blitTexture_clone, uv().flipY() );

			const width = Math.min( blitTexture_clone.image.width, maxTextureSize );
			const height = Math.min( blitTexture_clone.image.height, maxTextureSize );

			renderer.setSize( width, height );
			renderer.outputColorSpace = blitTexture_clone.colorSpace;

			_quadMesh.material = material;
			_quadMesh.render( renderer );

			const canvas = document.createElement( 'canvas' );
			const context = canvas.getContext( '2d' );

			canvas.width = width;
			canvas.height = height;

			context.drawImage( renderer.domElement, 0, 0, width, height );

			const readableTexture = new CanvasTexture( canvas );

			/* set to the original texture parameters */

			readableTexture.offset.set( blitTexture.offset.x, blitTexture.offset.y );
			readableTexture.repeat.set( blitTexture.repeat.x, blitTexture.repeat.y );
			readableTexture.colorSpace = blitTexture.colorSpace;
			readableTexture.minFilter = blitTexture.minFilter;
			readableTexture.magFilter = blitTexture.magFilter;
			readableTexture.wrapS = blitTexture.wrapS;
			readableTexture.wrapT = blitTexture.wrapT;
			readableTexture.name = blitTexture.name;

			blitTexture_clone.dispose();

			return readableTexture;

		}

		return { decompress, renderer };

	} catch ( error ) {

		/* should not really get here */
		throw new Error( 'THREE.OBJExporter: Could not import decompress function!' );

	}

}

/**
 * https://github.com/gkjohnson/collada-exporter-js
 *
 * Usage:
 *  const exporter = new ColladaExporter();
 *
 *  const data = exporter.parse(mesh);
 *
 * Format Definition:
 *  https://www.khronos.org/collada/
 */

class ColladaExporter {

	constructor( manager ) {

		this.manager = manager || DefaultLoadingManager;

		this.decompress = null;
		this.renderer = null;

	}

	async parse( object, onDone, options = {} ) {

		const scope = this;

		const { decompress, renderer } = await import_decompress();

		scope.decompress = decompress;
		scope.renderer = renderer;

		options = Object.assign( {
			version: '1.4.1',
			author: null,
			textureDirectory: '',
			upAxis: 'Y_UP',
			unitName: null,
			unitMeter: null
		}, options );

		if ( options.upAxis.match( /^[XYZ]_UP$/ ) === null ) {

			console.error( 'ColladaExporter: Invalid upAxis: valid values are X_UP, Y_UP or Z_UP.' );
			return null;

		}

		if ( options.unitName !== null && options.unitMeter === null ) {

			console.error( 'ColladaExporter: unitMeter needs to be specified if unitName is specified.' );
			return null;

		}

		if ( options.unitMeter !== null && options.unitName === null ) {

			console.error( 'ColladaExporter: unitName needs to be specified if unitMeter is specified.' );
			return null;

		}

		if ( options.textureDirectory !== '' ) {

			options.textureDirectory = `${options.textureDirectory}/`.replace( /\\/g, '/' ).replace( /\/+/g, '/' );

		}

		const version = options.version;

		if ( version !== '1.4.1' && version !== '1.5.0' ) {

			console.warn( `ColladaExporter : Version ${version} not supported for export. Only 1.4.1 and 1.5.0.` );
			return null;

		} // Convert the urdf xml into a well-formatted, indented format


		function format( urdf ) {

			const IS_END_TAG = /^<\//;
			const IS_SELF_CLOSING = /(\?>$)|(\/>$)/;
			const HAS_TEXT = /<[^>]+>[^<]*<\/[^<]+>/;

			const pad = ( ch, num ) => num > 0 ? ch + pad( ch, num - 1 ) : '';

			let tagnum = 0;
			return urdf.match( /(<[^>]+>[^<]+<\/[^<]+>)|(<[^>]+>)/g ).map( tag => {

				if ( ! HAS_TEXT.test( tag ) && ! IS_SELF_CLOSING.test( tag ) && IS_END_TAG.test( tag ) ) {

					tagnum --;

				}

				const res = `${pad( '  ', tagnum )}${tag}`;

				if ( ! HAS_TEXT.test( tag ) && ! IS_SELF_CLOSING.test( tag ) && ! IS_END_TAG.test( tag ) ) {

					tagnum ++;

				}

				return res;

			} ).join( '\n' );

		}

		// Convert an image into a png format for saving

		function base64ToBuffer( str ) {

			const b = atob( str );
			const buf = new Uint8Array( b.length );

			for ( let i = 0, l = buf.length; i < l; i ++ ) {

				buf[ i ] = b.charCodeAt( i );

			}

			return buf;

		}

		let canvas, ctx;

		function imageToData( image, ext ) {

			canvas = canvas || document.createElement( 'canvas' );
			ctx = ctx || canvas.getContext( '2d' );
			canvas.width = image.width;
			canvas.height = image.height;

			// this seems to work fine for exporting TGA images as PNG but unflipped
			if ( image instanceof ImageData ) {

				ctx.putImageData( image, 0, 0 );

			} else if ( image.data && image.data.constructor === Uint8Array ) {

				let imgData = new ImageData( new Uint8ClampedArray( image.data ), image.width, image.height );

				ctx.putImageData( imgData, 0, 0 );

			} else {

				ctx.drawImage( image, 0, 0, canvas.width, canvas.height );

			}

			// Get the base64 encoded data
			const base64data = canvas.toDataURL( `image/${ext}`, 1 ).replace( /^data:image\/(png|jpg);base64,/, '' );

			// Convert to a uint8 array
			return base64ToBuffer( base64data );

		}

		function deinterleave( geometry, attribute = 'color' ) {

			const attr = geometry.attributes[ attribute ];
			const itemSize = attr.itemSize;
			const offset = attr.offset;

			const data = attr.data;

			if ( data === undefined ) return [];

			let iBA = new InterleavedBufferAttribute( data, itemSize, offset );

			let attr_items = deinterleaveAttribute( iBA );

			let temp_array = Array( attr_items.array.length );

			for ( let i = 0, l = attr_items.array.length; i < l; i ++ ) {

				temp_array[ i ] = isNaN( attr_items.array[ i ] ) ? 0 : attr_items.array[ i ]; // avoid NaN values

			}

			return new BufferAttribute( new Float32Array( temp_array ), itemSize );

		}

		function interleaved_buffer_attribute_check( geo ) {

			const attribute_array = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv1', 'uv2', 'uv3' ];

			for (const attribute of attribute_array) {

				if ( geo.attributes[ attribute ] && geo.attributes[ attribute ].isInterleavedBufferAttribute ) {

					if ( geo.attributes[ attribute ].data ) {

						if ( geo.attributes[ attribute ].data.array ) {

							let geometry_attribute_array = deinterleave( geo, attribute );

							geo.deleteAttribute( attribute );
							geo.setAttribute( attribute, geometry_attribute_array );

						}

					}

				} else if ( geo.attributes[ attribute ] ) {

					const itemSize = geo.attributes[ attribute ].itemSize;
					const arr = geo.attributes[ attribute ].array;

					let temp_array = Array( arr.length );

					for ( let i = 0, l = arr.length; i < l; i ++ ) {

						temp_array[ i ] = isNaN( arr[ i ] ) ? 0 : arr[ i ]; // avoid NaN values

					}

					geo.deleteAttribute( attribute );
					geo.setAttribute( attribute, new BufferAttribute( new Float32Array( temp_array ), itemSize ) );

				}

			}

			return geo;

		}

		// Returns an array of the same type starting at the `st` index,
		// and `ct` length

		function subArray( arr, st, ct ) {

			if ( Array.isArray( arr ) ) return arr.slice( st, st + ct ); else return new arr.constructor( arr.buffer, st * arr.BYTES_PER_ELEMENT, ct );

		}

		// Returns the string for a geometry's attribute

		function getAttribute( attr, name, params, type ) {

			const array = attr.array;
			const res = `<source id="${name}">` + `<float_array id="${name}-array" count="${array.length}">` + array.join( ' ' ) + '</float_array>' + '<technique_common>' + `<accessor source="#${name}-array" count="${Math.floor( array.length / attr.itemSize )}" stride="${attr.itemSize}">` + params.map( n => `<param name="${n}" type="${type}" />` ).join( '' ) + '</accessor>' + '</technique_common>' + '</source>';
			return res;

		}

		// Returns the string for a node's transform information

		let transMat;

		function getTransform( o ) {

			// ensure the object's matrix is up to date
			// before saving the transform
			o.updateMatrix();
			transMat = transMat || new Matrix4();
			transMat.copy( o.matrix );
			transMat.transpose();
			return `<matrix>${transMat.toArray().join( ' ' )}</matrix>`;

		}

		// Process the given piece of geometry into the geometry library
		// Returns the mesh id

		function processGeometry( g ) {

			let info = geometryInfo.get( g );

			if ( ! info ) {

				// convert the geometry to bufferGeometry if it isn't already
				const bufferGeometry = interleaved_buffer_attribute_check( g.clone() );

				if ( bufferGeometry.isBufferGeometry !== true ) {

					throw new Error( 'THREE.ColladaExporter: Geometry is not of type THREE.BufferGeometry.' );

				}

				const meshid = `Mesh${libraryGeometries.length + 1}`;
				const indexCount = bufferGeometry.index ? bufferGeometry.index.count * bufferGeometry.index.itemSize : bufferGeometry.attributes.position.count;
				const groups = bufferGeometry.groups != null && bufferGeometry.groups.length !== 0 ? bufferGeometry.groups : [ {
					start: 0,
					count: indexCount,
					materialIndex: 0
				} ];
				const gname = g.name ? ` name="${g.name}"` : '';
				let gnode = `<geometry id="${meshid}"${gname}><mesh>`; // define the geometry node and the vertices for the geometry

				const posName = `${meshid}-position`;
				const vertName = `${meshid}-vertices`;
				gnode += getAttribute( bufferGeometry.attributes.position, posName, [ 'X', 'Y', 'Z' ], 'float' );
				gnode += `<vertices id="${vertName}"><input semantic="POSITION" source="#${posName}" /></vertices>`; // NOTE: We're not optimizing the attribute arrays here, so they're all the same length and
				// can therefore share the same triangle indices. However, MeshLab seems to have trouble opening
				// models with attributes that share an offset.
				// MeshLab Bug#424: https://sourceforge.net/p/meshlab/bugs/424/
				// serialize normals

				let triangleInputs = `<input semantic="VERTEX" source="#${vertName}" offset="0" />`;

				if ( 'normal' in bufferGeometry.attributes ) {

					const normName = `${meshid}-normal`;
					gnode += getAttribute( bufferGeometry.attributes.normal, normName, [ 'X', 'Y', 'Z' ], 'float' );
					triangleInputs += `<input semantic="NORMAL" source="#${normName}" offset="0" />`;

				} // serialize uvs


				if ( 'uv' in bufferGeometry.attributes ) {

					const uvName = `${meshid}-texcoord`;
					gnode += getAttribute( bufferGeometry.attributes.uv, uvName, [ 'S', 'T' ], 'float' );
					triangleInputs += `<input semantic="TEXCOORD" source="#${uvName}" offset="0" set="0" />`;

				} // serialize lightmap uvs


				if ( 'uv1' in bufferGeometry.attributes ) {

					const uvName = `${meshid}-texcoord2`;
					gnode += getAttribute( bufferGeometry.attributes.uv1, uvName, [ 'S', 'T' ], 'float' );
					triangleInputs += `<input semantic="TEXCOORD" source="#${uvName}" offset="0" set="1" />`;

				} // serialize colors


				if ( 'color' in bufferGeometry.attributes ) {

					// colors are always written as floats
					const colName = `${meshid}-color`;
					gnode += getAttribute( bufferGeometry.attributes.color, colName, [ 'R', 'G', 'B' ], 'float' );
					triangleInputs += `<input semantic="COLOR" source="#${colName}" offset="0" />`;

				}

				let indexArray = null;

				if ( bufferGeometry.index ) {

					indexArray = bufferGeometry.index.array;

				} else {

					indexArray = new Array( indexCount );

					for ( let i = 0, l = indexArray.length; i < l; i ++ ) indexArray[ i ] = i;

				}

				for ( let i = 0, l = groups.length; i < l; i ++ ) {

					const group = groups[ i ];
					const subarr = subArray( indexArray, group.start, group.count );
					const polycount = subarr.length / 3;
					gnode += `<triangles material="MESH_MATERIAL_${group.materialIndex}" count="${polycount}">`;
					gnode += triangleInputs;
					gnode += `<p>${subarr.join( ' ' )}</p>`;
					gnode += '</triangles>';

				}

				gnode += '</mesh></geometry>';
				libraryGeometries.push( gnode );
				info = {
					meshid: meshid,
					bufferGeometry: bufferGeometry
				};
				geometryInfo.set( g, info );

			}

			return info;

		} // Process the given texture into the image library
		// Returns the image library


		function processTexture( tex ) {

			if ( tex.isCompressedTexture === true ) {

				tex = scope.decompress( tex.clone(), Infinity, scope.renderer );

			}

			let texid = imageMap.get( tex );

			if ( texid == null ) {

				texid = `image-${libraryImages.length + 1}`;
				const ext = 'png';
				const name = ( tex.name ? ( ( tex.name.toUpperCase().endsWith( '.PNG' ) || tex.name.toUpperCase().endsWith( '.JPG' ) ) ? tex.name.substring(0, tex.name.lastIndexOf( '.' ) ) : tex.name ) : tex.name ) || texid;
				let imageNode = `<image id="${texid}" name="${name}">`;

				if ( version === '1.5.0' ) {

					imageNode += `<init_from><ref>${options.textureDirectory}${name}.${ext}</ref></init_from>`;

				} else {

					// version image node 1.4.1
					imageNode += `<init_from>${options.textureDirectory}${name}.${ext}</init_from>`;

				}

				imageNode += '</image>';
				libraryImages.push( imageNode );
				imageMap.set( tex, texid );
				textures.push( {
					directory: options.textureDirectory,
					name,
					ext,
					data: imageToData( tex.image, ext ),
					original: tex
				} );

			}

			return texid;

		}

		// Process the given material into the material and effect libraries
		// Returns the material id

		function processMaterial( m ) {

			let matid = materialMap.get( m );

			if ( matid == null ) {

				matid = `Mat${libraryEffects.length + 1}`;

				let type = 'phong';

				if ( m.isMeshLambertMaterial === true ) {

					type = 'lambert';

				} else if ( m.isPointsMaterial === true ) {

					type = 'points';

				} else if ( m.isMeshBasicMaterial === true ) {

					type = 'constant';

					if ( m.map !== null ) {

						// The Collada spec does not support diffuse texture maps with the
						// constant shader type.
						// mrdoob/three.js#15469
						console.warn( 'ColladaExporter: Texture maps not supported with THREE.MeshBasicMaterial.' );

					}

				}

				const emissive = m.emissive ? m.emissive.clone() : new Color( 0, 0, 0 );
				const diffuse = m.color ? m.color.clone() : new Color( 0, 0, 0 );
				const specular = m.specular ? m.specular.clone() : new Color( 1, 1, 1 );
				const shininess = m.shininess || 0;
				const reflectivity = m.reflectivity || 0;
				//emissive.convertLinearToSRGB();
				//specular.convertLinearToSRGB();
				//diffuse.convertLinearToSRGB();

				// Do not export and alpha map for the reasons mentioned in issue (#13792)
				// in three.js alpha maps are black and white, but collada expects the alpha
				// channel to specify the transparency

				let transparencyNode = '';

				if ( m.transparent === true ) {

					transparencyNode += '<transparency>' + ( ( m.opacity < 1 ) ? `<float sid="transparency">${m.opacity}</float>` : '<float sid="transparency">1</float>' ) + '</transparency>';

				}

				const techniqueNode = `<technique sid="common"><${type}>` + '<emission>' + ( m.emissiveMap ? '<texture texture="emissive-sampler" texcoord="TEXCOORD" />' + `<color sid="emission">${emissive.r} ${emissive.g} ${emissive.b} 1</color>` : `<color sid="emission">${emissive.r} ${emissive.g} ${emissive.b} 1</color>` ) + '</emission>' + ( type !== 'constant' ? '<diffuse>' + ( m.map ? '<texture texture="diffuse-sampler" texcoord="TEXCOORD" />' + `<color sid="diffuse">${diffuse.r} ${diffuse.g} ${diffuse.b} 1</color>` : `<color sid="diffuse">${diffuse.r} ${diffuse.g} ${diffuse.b} 1</color>` ) + '</diffuse>' : '' ) + ( type !== 'constant' ? '<bump>' + ( m.normalMap ? '<texture texture="bump-sampler" texcoord="TEXCOORD" />' : '' ) + '</bump>' : '' ) + ( type === 'phong' ?  '<specular>' + ( m.specularMap ? '<texture texture="specular-sampler" texcoord="TEXCOORD" />' + `<color sid="specular">${specular.r} ${specular.g} ${specular.b} 1</color>` : `<color sid="specular">${specular.r} ${specular.g} ${specular.b} 1</color>` ) + '</specular>' : '' ) + `<shininess><float>${shininess}</float></shininess>` + `<reflective><color>${diffuse.r} ${diffuse.g} ${diffuse.b} 1</color></reflective>` + `<reflectivity><float>${reflectivity}</float></reflectivity>` + transparencyNode + `</${type}></technique>`;
				const effectnode = `<effect id="${matid}-effect">` + '<profile_COMMON>' + ( m.map ? '<newparam sid="diffuse-surface"><surface type="2D">' + `<init_from>${processTexture( m.map )}</init_from>` + '</surface></newparam>' + '<newparam sid="diffuse-sampler"><sampler2D><source>diffuse-surface</source></sampler2D></newparam>' : '' ) + ( m.specularMap ? '<newparam sid="specular-surface"><surface type="2D">' + `<init_from>${processTexture( m.specularMap )}</init_from>` + '</surface></newparam>' + '<newparam sid="specular-sampler"><sampler2D><source>specular-surface</source></sampler2D></newparam>' : '' ) + ( m.emissiveMap ? '<newparam sid="emissive-surface"><surface type="2D">' + `<init_from>${processTexture( m.emissiveMap )}</init_from>` + '</surface></newparam>' + '<newparam sid="emissive-sampler"><sampler2D><source>emissive-surface</source></sampler2D></newparam>' : '' ) + ( m.normalMap ? '<newparam sid="bump-surface"><surface type="2D">' + `<init_from>${processTexture( m.normalMap )}</init_from>` + '</surface></newparam>' + '<newparam sid="bump-sampler"><sampler2D><source>bump-surface</source></sampler2D></newparam>' : '' ) + techniqueNode + ( m.side === DoubleSide ? '<extra><technique profile="THREEJS"><double_sided sid="double_sided" type="int">1</double_sided></technique></extra>' : '' ) + '</profile_COMMON>' + '</effect>';
				const materialName = m.name ? ` name="${m.name}"` : '';
				const materialNode = `<material id="${matid}"${materialName}><instance_effect url="#${matid}-effect" /></material>`;
				libraryMaterials.push( materialNode );
				libraryEffects.push( effectnode );
				materialMap.set( m, matid );

			}

			return matid;

		} // Recursively process the object into a scene


		function processObject( o ) {

			let node = `<node name="${o.name}">`;
			node += getTransform( o );

			if ( ( o.isMesh === true || o.isPoints === true ) && o.geometry ) {

				// function returns the id associated with the mesh and a "BufferGeometry" version
				// of the geometry in case it's not a geometry.
				const geomInfo = processGeometry( o.geometry.clone() );
				const meshid = geomInfo.meshid;
				const geometry = geomInfo.bufferGeometry; // ids of the materials to bind to the geometry

				let matids = null;
				let matidsArray; // get a list of materials to bind to the sub groups of the geometry.
				// If the amount of subgroups is greater than the materials, than reuse
				// the materials.

				const mat = o.material ? o.material : new MeshBasicMaterial();
				const materials = Array.isArray( mat ) ? mat : [ mat ];

				if ( geometry.groups.length > materials.length ) {

					matidsArray = new Array( geometry.groups.length );

				} else {

					matidsArray = new Array( materials.length );

				}

				matids = matidsArray.fill().map( ( v, i ) => processMaterial( materials[ i % materials.length ] ) );
				node += `<instance_geometry url="#${meshid}">` + ( matids.length > 0 ? '<bind_material><technique_common>' + matids.map( ( id, i ) => `<instance_material symbol="MESH_MATERIAL_${i}" target="#${id}" >` + '<bind_vertex_input semantic="TEXCOORD" input_semantic="TEXCOORD" input_set="0" />' + '</instance_material>' ).join( '' ) + '</technique_common></bind_material>' : '' ) + '</instance_geometry>';

			}

			o.children.forEach( c => node += processObject( c ) );
			node += '</node>';
			return node;

		}

		const geometryInfo = new WeakMap();
		const materialMap = new WeakMap();
		const imageMap = new WeakMap();
		const textures = [];
		const libraryImages = [];
		const libraryGeometries = [];
		const libraryEffects = [];
		const libraryMaterials = [];
		const libraryVisualScenes = processObject( object );
		const specLink = version === '1.4.1' ? 'http://www.collada.org/2005/11/COLLADASchema' : 'https://www.khronos.org/collada/';
		let dae = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>' + `<COLLADA xmlns="${specLink}" version="${version}">` + '<asset>' + ( '<contributor>' + '<authoring_tool>three.js Collada Exporter</authoring_tool>' + ( options.author !== null ? `<author>${options.author}</author>` : '' ) + '</contributor>' + `<created>${new Date().toISOString()}</created>` + `<modified>${new Date().toISOString()}</modified>` + ( options.unitName !== null ? `<unit name="${options.unitName}" meter="${options.unitMeter}" />` : '' ) + `<up_axis>${options.upAxis}</up_axis>` ) + '</asset>';
		dae += `<library_images>${libraryImages.join( '' )}</library_images>`;
		dae += `<library_effects>${libraryEffects.join( '' )}</library_effects>`;
		dae += `<library_materials>${libraryMaterials.join( '' )}</library_materials>`;
		dae += `<library_geometries>${libraryGeometries.join( '' )}</library_geometries>`;
		dae += `<library_visual_scenes><visual_scene id="Scene" name="scene">${libraryVisualScenes}</visual_scene></library_visual_scenes>`;
		dae += '<scene><instance_visual_scene url="#Scene"/></scene>';
		dae += '</COLLADA>';
		const res = {
			data: format( dae ),
			textures
		};

		if ( scope.renderer !== null ) {

			scope.renderer.dispose();
			scope.renderer = null;

		}

		if ( typeof onDone === 'function' ) {

			requestAnimationFrame( () => onDone( res ) );

		}

		return res;

	}

}

export { ColladaExporter };
